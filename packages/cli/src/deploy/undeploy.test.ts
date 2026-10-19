import { expect, it } from "vitest";

import type { AwsClients } from "../aws/clients.ts";
import type { DeployContext } from "./context.ts";
import { teardown } from "./undeploy.ts";

function createContext(send: (command: unknown) => Promise<unknown>): DeployContext {
  const clients = {
    cloudfront: {
      send: async () => ({
        DistributionList: { Items: [] },
        OriginAccessControlList: { Items: [] },
      }),
    },
    lambda: { send },
    apiGateway: { send: async () => ({ Items: [] }) },
    sqs: {
      send: async () => {
        const error = new Error("missing");
        error.name = "QueueDoesNotExist";
        throw error;
      },
    },
    dynamodb: {
      send: async () => {
        const error = new Error("missing");
        error.name = "ResourceNotFoundException";
        throw error;
      },
    },
    s3: {
      send: async () => {
        const error = new Error("missing");
        error.name = "NotFound";
        throw error;
      },
    },
    iam: {
      send: async () => {
        const error = new Error("missing");
        error.name = "NoSuchEntityException";
        throw error;
      },
    },
  } as unknown as AwsClients;

  return {
    region: "us-east-1",
    accountId: "111122223333",
    dryRun: true,
    repoRoot: ".",
    appPrefix: "demo",
    mediaBucket: "demo-media",
    log: () => undefined,
    clients,
  };
}

it("reports that existing Lambdas would be deleted in a dry run", async () => {
  const messages: string[] = [];
  const ctx = createContext(async () => ({}));
  ctx.log = (message: string) => messages.push(message);

  await teardown(ctx, true);

  expect(messages).toContain("would delete Lambda demo-admin-revalidation");
  expect(messages).toContain("would delete Lambda demo-api");
});

it("keeps data when asked", async () => {
  const messages: string[] = [];
  const ctx = createContext(async () => ({}));
  ctx.log = (message: string) => messages.push(message);

  await teardown(ctx, true);

  expect(
    messages.some(
      (message) => message.startsWith("keeping data:") && message.includes("demo-users"),
    ),
  ).toBe(true);
  expect(
    messages.some(
      (message) =>
        message.startsWith("keeping data:") &&
        message.includes("demo-content-types") &&
        message.includes("demo-content-entries"),
    ),
  ).toBe(true);
  expect(messages.some((message) => message.includes("would delete DynamoDB table"))).toBe(false);
  expect(messages.some((message) => message.includes("would empty and delete S3 bucket"))).toBe(
    false,
  );
});

import {
  DeleteFunctionCommand as DeleteCloudFrontFunctionCommand,
  DescribeFunctionCommand,
} from "@aws-sdk/client-cloudfront";
import {
  DeleteApiMappingCommand,
  DeleteDomainNameCommand,
  GetApiMappingsCommand,
  GetApisCommand,
  GetDomainNamesCommand,
} from "@aws-sdk/client-apigatewayv2";
import {
  ChangeResourceRecordSetsCommand,
  ListHostedZonesByNameCommand,
  ListResourceRecordSetsCommand,
} from "@aws-sdk/client-route-53";
import { DeleteCertificateCommand } from "@aws-sdk/client-acm";
import { DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { GetFunctionCommand } from "@aws-sdk/client-lambda";

function awsError(name: string): never {
  const error = new Error(name);
  error.name = name;
  throw error;
}

interface TeardownDomainOptions {
  dryRun: boolean;
  certDeleteError?: (arn: string) => unknown;
}

function createTeardownContext(
  records: unknown[],
  logs: string[],
  options: TeardownDomainOptions,
): DeployContext {
  const send = async (command: unknown) => {
    records.push(command);
    if (command instanceof DescribeFunctionCommand) return { ETag: "E1" };
    if (command instanceof GetDomainNamesCommand) {
      return { Items: [{ DomainName: "api.example.com" }] };
    }
    if (command instanceof GetApiMappingsCommand) return { Items: [{ ApiMappingId: "map1" }] };
    if (command instanceof GetApisCommand) return { Items: [] };
    if (command instanceof GetFunctionCommand) awsError("ResourceNotFoundException");
    if (command instanceof ListHostedZonesByNameCommand) {
      return { HostedZones: [{ Id: "/hostedzone/Z9", Name: "example.com." }] };
    }
    if (command instanceof ListResourceRecordSetsCommand) {
      return {
        IsTruncated: false,
        ResourceRecordSets: [
          {
            Name: "example.com.",
            Type: "A",
            AliasTarget: { DNSName: "dist.cloudfront.net", HostedZoneId: "Z2FDTNDATAQYW2" },
          },
          {
            Name: "_x.www.example.com.",
            Type: "CNAME",
            TTL: 300,
            ResourceRecords: [{ Value: "_y.acm-validations.aws." }],
          },
          {
            Name: "example.com.",
            Type: "MX",
            TTL: 300,
            ResourceRecords: [{ Value: "10 mail.example.com." }],
          },
        ],
      };
    }
    if (command instanceof DeleteCertificateCommand && options.certDeleteError) {
      const arn = (command as { input: { CertificateArn?: string } }).input.CertificateArn ?? "";
      return options.certDeleteError(arn);
    }
    return {};
  };

  const clients = {
    cloudfront: {
      send: async (command: unknown) => {
        records.push(command);
        if (command instanceof DescribeFunctionCommand) return { ETag: "E1" };
        return { DistributionList: { Items: [] }, OriginAccessControlList: { Items: [] } };
      },
    },
    lambda: {
      send: async (command: unknown) => {
        records.push(command);
        return awsError("ResourceNotFoundException");
      },
    },
    apiGateway: { send },
    sqs: {
      send: async (command: unknown) => {
        records.push(command);
        return awsError("QueueDoesNotExist");
      },
    },
    dynamodb: {
      send: async (command: unknown) => {
        records.push(command);
        return {};
      },
    },
    s3: { send: async () => ({}) },
    iam: {
      send: async (command: unknown) => {
        records.push(command);
        return awsError("NoSuchEntityException");
      },
    },
    route53: { send },
    acm: { send },
    acmUsEast1: { send },
    sts: { send: async () => ({}) },
  } as unknown as AwsClients;

  return {
    region: "eu-west-1",
    accountId: "111122223333",
    dryRun: options.dryRun,
    repoRoot: ".",
    appPrefix: "demo",
    mediaBucket: "demo-media",
    adminDomain: "example.com",
    apiDomain: "api.example.com",
    hostedZone: "example.com",
    adminCertificateArn: "arn:admin",
    apiCertificateArn: "arn:api",
    log: (message: string) => logs.push(message),
    clients,
  };
}

it("dry run lists the domain resources that would be removed", async () => {
  const records: unknown[] = [];
  const logs: string[] = [];
  const ctx = createTeardownContext(records, logs, { dryRun: true });

  await teardown(ctx, true);

  expect(logs).toContain("would delete CloudFront redirect function demo-admin-redirect");
  expect(logs).toContain("would delete API Gateway custom domain api.example.com and its mappings");
  expect(
    logs.some((message) => message.includes("would delete Route 53 record example.com. (A)")),
  ).toBe(true);
  expect(
    logs.some((message) => message.includes("would delete ACM certificate arn:admin (admin)")),
  ).toBe(true);
  expect(
    logs.some((message) => message.includes("would delete ACM certificate arn:api (api)")),
  ).toBe(true);
  expect(
    records.some(
      (command) =>
        command instanceof DeleteCloudFrontFunctionCommand ||
        command instanceof DeleteApiMappingCommand ||
        command instanceof DeleteDomainNameCommand ||
        command instanceof ChangeResourceRecordSetsCommand ||
        command instanceof DeleteCertificateCommand,
    ),
  ).toBe(false);
});

it("deletes the redirect function, custom domain, domain records, and certificates", async () => {
  const records: unknown[] = [];
  const logs: string[] = [];
  const ctx = createTeardownContext(records, logs, { dryRun: false });

  await teardown(ctx, true);

  expect(logs).toContain("deleted CloudFront redirect function demo-admin-redirect");
  expect(logs).toContain("deleted API Gateway custom domain api.example.com");
  expect(logs).toContain("deleted 2 Route 53 domain records");
  expect(
    logs.some((message) => message.includes("deleted ACM certificate arn:admin (admin)")),
  ).toBe(true);
  expect(logs.some((message) => message.includes("deleted ACM certificate arn:api (api)"))).toBe(
    true,
  );

  const change = records.find((command) => command instanceof ChangeResourceRecordSetsCommand) as
    | { input: { ChangeBatch?: { Changes?: { Action?: string }[] } } }
    | undefined;
  expect(change?.input.ChangeBatch?.Changes).toHaveLength(2);
  expect(change?.input.ChangeBatch?.Changes?.every((item) => item.Action === "DELETE")).toBe(true);

  expect(records.some((command) => command instanceof DeleteApiMappingCommand)).toBe(true);
  expect(records.some((command) => command instanceof DeleteCloudFrontFunctionCommand)).toBe(true);

  const certDeletes = records.filter(
    (command): command is { input: { CertificateArn?: string } } =>
      command instanceof DeleteCertificateCommand,
  );
  expect(certDeletes.map((command) => command.input.CertificateArn).sort()).toEqual([
    "arn:admin",
    "arn:api",
  ]);
});

it("tolerates certificates that are still in use", async () => {
  const records: unknown[] = [];
  const logs: string[] = [];
  const ctx = createTeardownContext(records, logs, {
    dryRun: false,
    certDeleteError: (arn) => (arn === "arn:admin" ? awsError("ResourceInUseException") : {}),
  });

  await teardown(ctx, true);

  expect(
    logs.some((message) => message.includes("arn:admin") && message.includes("still in use")),
  ).toBe(true);
  expect(logs.some((message) => message.includes("deleted ACM certificate arn:api"))).toBe(true);
});

it("deletes the users and reset token tables when the data is removed", async () => {
  const records: unknown[] = [];
  const logs: string[] = [];
  const ctx = createTeardownContext(records, logs, { dryRun: false });

  await teardown(ctx, false);

  const deleted = records
    .filter(
      (command): command is { input: { TableName?: string } } =>
        command instanceof DeleteTableCommand,
    )
    .map((command) => command.input.TableName);
  expect(deleted).toContain("demo-users");
  expect(deleted).toContain("demo-reset-tokens");
  expect(deleted).toContain("demo-content-types");
  expect(deleted).toContain("demo-content-entries");
});
