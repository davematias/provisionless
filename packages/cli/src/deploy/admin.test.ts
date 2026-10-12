import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CreateDistributionCommand,
  CreateFunctionCommand,
  CreateOriginAccessControlCommand,
  DescribeFunctionCommand,
  GetDistributionCommand,
  GetFunctionCommand as GetCloudFrontFunctionCommand,
  ListDistributionsCommand,
  ListOriginAccessControlsCommand,
  PublishFunctionCommand,
  UpdateDistributionCommand,
  UpdateFunctionCommand,
} from "@aws-sdk/client-cloudfront";
import { GetFunctionCommand, GetFunctionUrlConfigCommand } from "@aws-sdk/client-lambda";
import { GetRoleCommand } from "@aws-sdk/client-iam";
import { DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import { GetQueueAttributesCommand, GetQueueUrlCommand } from "@aws-sdk/client-sqs";
import {
  ChangeResourceRecordSetsCommand,
  ListHostedZonesByNameCommand,
} from "@aws-sdk/client-route-53";
import { expect, it } from "vitest";

import type { AwsClients } from "../aws/clients.ts";
import {
  buildDistributionConfig,
  configureAdminDns,
  deployAdmin,
  ensureRedirectFunction,
  redirectFunctionCode,
  type AdminDomainConfig,
  type OpenNextOutput,
} from "./admin.ts";
import type { DeployContext } from "./context.ts";

const noop = (): void => undefined;

function createSend(
  records: unknown[],
  respond: (command: unknown) => unknown,
): (command: unknown) => Promise<unknown> {
  return async (command: unknown) => {
    records.push(command);
    return respond(command);
  };
}

function createContext(
  send: (command: unknown) => Promise<unknown>,
  dryRun = false,
): DeployContext {
  return {
    region: "us-east-1",
    accountId: "111122223333",
    dryRun,
    repoRoot: ".",
    appPrefix: "demo",
    mediaBucket: "demo-media",
    log: noop,
    clients: {
      cloudfront: { send },
      route53: { send },
    } as unknown as AwsClients,
  };
}

function missingFunction(): never {
  const error = new Error("missing");
  error.name = "NoSuchFunctionExists";
  throw error;
}

function text(bytes: unknown): string {
  return Buffer.from(bytes as Uint8Array).toString("utf8");
}

const OUTPUT: OpenNextOutput = {
  origins: {
    s3: { copy: [] },
    default: { bundle: ".open-next/server-functions/default", handler: "index.handler" },
    imageOptimizer: { bundle: ".open-next/image-optimization-function", handler: "index.handler" },
  },
  additionalProps: {
    revalidationFunction: { bundle: ".open-next/revalidation-function", handler: "index.handler" },
  },
  behaviors: [
    { pattern: "*", origin: "default" },
    { pattern: "_next/image*", origin: "imageOptimizer" },
    { pattern: "_next/static/*", origin: "s3" },
  ],
};

const DOMAIN: AdminDomainConfig = {
  canonical: "example.com",
  aliases: ["example.com", "www.example.com"],
  certificateArn: "arn:aws:acm:us-east-1:111122223333:certificate/abc",
  redirectFunctionArn: "arn:aws:cloudfront::111122223333:function/demo-admin-redirect",
};

it("generates aliases, ACM certificate, and TLS policy for the admin domain", () => {
  const config = buildDistributionConfig(OUTPUT, [], "caller", "demo-admin", DOMAIN);

  expect(config.Aliases).toEqual({ Quantity: 2, Items: ["example.com", "www.example.com"] });
  expect(config.ViewerCertificate).toEqual({
    ACMCertificateArn: DOMAIN.certificateArn,
    SSLSupportMethod: "sni-only",
    MinimumProtocolVersion: "TLSv1.2_2021",
  });
});

it("attaches the redirect function to every cache behavior", () => {
  const config = buildDistributionConfig(OUTPUT, [], "caller", "demo-admin", DOMAIN);

  expect(config.DefaultCacheBehavior?.FunctionAssociations).toEqual({
    Quantity: 1,
    Items: [{ EventType: "viewer-request", FunctionARN: DOMAIN.redirectFunctionArn }],
  });
  const patterns = (config.CacheBehaviors?.Items ?? []).map((behavior) => behavior.PathPattern);
  expect(patterns).toEqual(["_next/image*", "_next/static/*"]);
  for (const behavior of config.CacheBehaviors?.Items ?? []) {
    expect(behavior.FunctionAssociations?.Items).toEqual([
      { EventType: "viewer-request", FunctionARN: DOMAIN.redirectFunctionArn },
    ]);
  }
});

it("keeps the default certificate and no aliases without a domain", () => {
  const config = buildDistributionConfig(OUTPUT, [], "caller", "demo-admin");

  expect(config.Aliases).toEqual({ Quantity: 0 });
  expect(config.ViewerCertificate).toEqual({ CloudFrontDefaultCertificate: true });
  expect(config.DefaultCacheBehavior?.FunctionAssociations).toEqual({ Quantity: 0, Items: [] });
  for (const behavior of config.CacheBehaviors?.Items ?? []) {
    expect(behavior.FunctionAssociations).toEqual({ Quantity: 0, Items: [] });
  }
});

it("builds a redirect function that 301s non-canonical hosts", () => {
  const code = redirectFunctionCode("example.com");

  expect(code).toContain('var canonical = "example.com"');
  expect(code).toContain("statusCode: 301");
  expect(code).toContain('"https://" + canonical + request.uri');
  expect(code).toContain("return request;");
});

it("creates and publishes the redirect function when it does not exist", async () => {
  const commands: unknown[] = [];
  const code = redirectFunctionCode("example.com");
  let devProbes = 0;
  let liveProbes = 0;
  const ctx = createContext(
    createSend(commands, (command) => {
      if (command instanceof DescribeFunctionCommand) {
        const stage = (command as { input: { Stage?: string } }).input.Stage;
        if (stage === "DEVELOPMENT") {
          devProbes += 1;
          if (devProbes === 1) {
            return missingFunction();
          }
          return { ETag: "E1", FunctionSummary: { Status: "UNPUBISHED" } };
        }
        liveProbes += 1;
        if (liveProbes === 1) {
          return missingFunction();
        }
        return { ETag: "E2", FunctionSummary: { Status: "DEPLOYED" } };
      }
      return {};
    }),
  );

  const arn = await ensureRedirectFunction(ctx, "demo-admin-redirect", "example.com");

  expect(arn).toBe("arn:aws:cloudfront::111122223333:function/demo-admin-redirect");
  const create = commands.find((command) => command instanceof CreateFunctionCommand) as
    | { input: { Name?: string; FunctionCode?: Uint8Array } }
    | undefined;
  expect(create?.input.Name).toBe("demo-admin-redirect");
  expect(text(create?.input.FunctionCode)).toBe(code);
  expect(commands.some((command) => command instanceof UpdateFunctionCommand)).toBe(false);
  const publish = commands.find((command) => command instanceof PublishFunctionCommand) as
    | { input: { IfMatch?: string } }
    | undefined;
  expect(publish?.input.IfMatch).toBe("E1");
});

it("skips write operations when the published function is already correct", async () => {
  const commands: unknown[] = [];
  const code = redirectFunctionCode("example.com");
  const ctx = createContext(
    createSend(commands, (command) => {
      if (command instanceof DescribeFunctionCommand) {
        return { ETag: "E1", FunctionSummary: { Status: "DEPLOYED" } };
      }
      if (command instanceof GetCloudFrontFunctionCommand) {
        return { FunctionCode: Buffer.from(code, "utf8") };
      }
      return {};
    }),
  );

  await ensureRedirectFunction(ctx, "demo-admin-redirect", "example.com");

  expect(
    commands.some(
      (command) =>
        command instanceof CreateFunctionCommand ||
        command instanceof UpdateFunctionCommand ||
        command instanceof PublishFunctionCommand,
    ),
  ).toBe(false);
});

it("updates and republishes when the redirect target changes", async () => {
  const commands: unknown[] = [];
  const code = redirectFunctionCode("example.com");
  let devProbes = 0;
  const ctx = createContext(
    createSend(commands, (command) => {
      if (command instanceof DescribeFunctionCommand) {
        const stage = (command as { input: { Stage?: string } }).input.Stage;
        if (stage === "LIVE") {
          return { ETag: "E0", FunctionSummary: { Status: "DEPLOYED" } };
        }
        devProbes += 1;
        return {
          ETag: "E1",
          FunctionSummary: { Status: devProbes === 1 ? "DEPLOYED" : "UNPUBISHED" },
        };
      }
      if (command instanceof GetCloudFrontFunctionCommand) {
        return { FunctionCode: Buffer.from("old code", "utf8") };
      }
      return {};
    }),
  );

  await ensureRedirectFunction(ctx, "demo-admin-redirect", "example.com");

  const update = commands.find((command) => command instanceof UpdateFunctionCommand) as
    | { input: { IfMatch?: string; FunctionCode?: Uint8Array } }
    | undefined;
  expect(update?.input.IfMatch).toBe("E1");
  expect(text(update?.input.FunctionCode)).toBe(code);
  const publish = commands.find((command) => command instanceof PublishFunctionCommand) as
    | { input: { IfMatch?: string } }
    | undefined;
  expect(publish?.input.IfMatch).toBe("E1");
});

it("does not touch AWS for the redirect function during a dry run", async () => {
  const commands: unknown[] = [];
  const ctx = createContext(
    createSend(commands, () => ({})),
    true,
  );

  const arn = await ensureRedirectFunction(ctx, "demo-admin-redirect", "example.com");

  expect(arn).toBe("arn:aws:cloudfront::111122223333:function/demo-admin-redirect");
  expect(commands).toEqual([]);
});

it("upserts Route 53 alias records when a hosted zone is configured", async () => {
  const commands: unknown[] = [];
  const ctx = createContext(
    createSend(commands, (command) => {
      if (command instanceof ListHostedZonesByNameCommand) {
        return { HostedZones: [{ Id: "/hostedzone/Z9", Name: "example.com." }] };
      }
      return {};
    }),
  );
  ctx.hostedZone = "example.com";

  await configureAdminDns(ctx, ["example.com", "www.example.com"], "dist.cloudfront.net");

  const change = commands.find((command) => command instanceof ChangeResourceRecordSetsCommand) as
    | { input: { HostedZoneId?: string; ChangeBatch?: { Changes?: unknown[] } } }
    | undefined;
  expect(change?.input.HostedZoneId).toBe("Z9");
  expect(change?.input.ChangeBatch?.Changes).toHaveLength(4);
});

it("prints the DNS target when no hosted zone is configured", async () => {
  const commands: unknown[] = [];
  const logs: string[] = [];
  const ctx = createContext(createSend(commands, () => ({})));
  ctx.log = (message: string) => logs.push(message);

  await configureAdminDns(ctx, ["example.com", "www.example.com"], "dist.cloudfront.net");

  expect(commands).toEqual([]);
  expect(
    logs.some(
      (message) =>
        message.includes("example.com") &&
        message.includes("www.example.com") &&
        message.includes("dist.cloudfront.net"),
    ),
  ).toBe(true);
});

function tempRepoWithBuild(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "provisionless-admin-"));
  const adminDir = join(repoRoot, "packages", "admin");
  mkdirSync(adminDir, { recursive: true });
  writeFileSync(
    join(repoRoot, "package.json"),
    JSON.stringify({ name: "fixture", workspaces: ["packages/*"] }),
  );
  writeFileSync(
    join(adminDir, "package.json"),
    JSON.stringify({
      name: "@provisionless/admin",
      scripts: { "build:lambda": "true" },
    }),
  );
  const openNext = join(adminDir, ".open-next");
  mkdirSync(openNext, { recursive: true });
  writeFileSync(join(openNext, "open-next.output.json"), JSON.stringify(OUTPUT));
  for (const bundle of [
    "server-functions/default",
    "image-optimization-function",
    "revalidation-function",
  ]) {
    const dir = join(openNext, bundle);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.mjs"), "export const handler = () => {};");
  }
  return repoRoot;
}

function createFullContext(
  records: unknown[],
  respond: (command: unknown) => unknown,
  logs: string[],
  options: {
    dryRun: boolean;
    adminDomain?: string;
    adminCertificateArn?: string;
    hostedZone?: string;
  },
): DeployContext {
  const send = createSend(records, respond);
  return {
    region: "eu-west-1",
    accountId: "111122223333",
    dryRun: options.dryRun,
    repoRoot: tempRepoWithBuild(),
    appPrefix: "demo",
    mediaBucket: "demo-media",
    adminDomain: options.adminDomain,
    adminCertificateArn: options.adminCertificateArn,
    adminCertificateIssued: Boolean(options.adminCertificateArn) && !options.dryRun,
    hostedZone: options.hostedZone,
    log: (message: string) => logs.push(message),
    clients: {
      s3: { send },
      iam: { send },
      lambda: { send },
      sqs: { send },
      dynamodb: { send },
      cloudfront: { send },
      route53: { send },
    } as unknown as AwsClients,
  };
}

function stubAws(probes: { dev: number; live: number; oac: number }) {
  return (command: unknown): unknown => {
    if (command instanceof DescribeTableCommand) return { Table: { TableStatus: "ACTIVE" } };
    if (command instanceof GetQueueUrlCommand) return { QueueUrl: "https://sqs.example.com/q" };
    if (command instanceof GetQueueAttributesCommand) {
      return {
        Attributes: { QueueArn: "arn:aws:sqs:eu-west-1:111122223333:demo-admin-revalidation.fifo" },
      };
    }
    if (command instanceof GetRoleCommand) {
      return { Role: { Arn: "arn:aws:iam::111122223333:role/demo-admin-lambda-role" } };
    }
    if (command instanceof GetFunctionCommand) {
      return { Configuration: { State: "Active", LastUpdateStatus: "Successful" } };
    }
    if (command instanceof GetFunctionUrlConfigCommand) {
      return { FunctionUrl: "https://demo.lambda-url.eu-west-1.on.aws" };
    }
    if (command instanceof ListOriginAccessControlsCommand)
      return { OriginAccessControlList: { Items: [] } };
    if (command instanceof CreateOriginAccessControlCommand) {
      probes.oac += 1;
      return { OriginAccessControl: { Id: `oac${probes.oac}` } };
    }
    if (command instanceof ListDistributionsCommand) return { DistributionList: { Items: [] } };
    if (command instanceof CreateDistributionCommand) {
      return { Distribution: { Id: "DIST1", DomainName: "abc123.cloudfront.net" } };
    }
    if (command instanceof DescribeFunctionCommand) {
      const stage = (command as { input: { Stage?: string } }).input.Stage;
      if (stage === "DEVELOPMENT") {
        probes.dev += 1;
        if (probes.dev === 1) return missingFunction();
        return { ETag: "E1", FunctionSummary: { Status: "UNPUBISHED" } };
      }
      probes.live += 1;
      if (probes.live === 1) return missingFunction();
      return { ETag: "E2", FunctionSummary: { Status: "DEPLOYED" } };
    }
    return {};
  };
}

interface DomainConfigInput {
  Aliases?: { Quantity?: number; Items?: string[] };
  ViewerCertificate?: Record<string, unknown>;
  DefaultCacheBehavior?: { FunctionAssociations?: { Quantity?: number; Items?: unknown[] } };
}

it("creates the distribution with aliases, certificate, and redirect in a full run", async () => {
  const commands: unknown[] = [];
  const logs: string[] = [];
  const probes = { dev: 0, live: 0, oac: 0 };
  const ctx = createFullContext(commands, stubAws(probes), logs, {
    dryRun: false,
    adminDomain: "example.com",
    adminCertificateArn: "arn:aws:acm:us-east-1:111122223333:certificate/abc",
  });

  const result = await deployAdmin(ctx, "https://api.example.test");

  expect(result.url).toBe("https://example.com");
  const create = commands.find((command) => command instanceof CreateFunctionCommand) as
    | { input: { Name?: string } }
    | undefined;
  expect(create?.input.Name).toBe("demo-admin-redirect");
  const distribution = commands.find(
    (command) => command instanceof CreateDistributionCommand,
  ) as unknown as { input: { DistributionConfig?: DomainConfigInput } };
  const distConfig = distribution.input.DistributionConfig as DomainConfigInput;
  expect(distConfig.Aliases).toEqual({
    Quantity: 2,
    Items: ["example.com", "www.example.com"],
  });
  expect(distConfig.ViewerCertificate).toEqual({
    ACMCertificateArn: "arn:aws:acm:us-east-1:111122223333:certificate/abc",
    SSLSupportMethod: "sni-only",
    MinimumProtocolVersion: "TLSv1.2_2021",
  });
  expect(distConfig.DefaultCacheBehavior?.FunctionAssociations?.Quantity).toBe(1);
  const ctxLogs = logs;
  expect(
    ctxLogs.some(
      (message) =>
        message.includes("add A/AAAA alias records in your DNS provider") &&
        message.includes("abc123.cloudfront.net"),
    ),
  ).toBe(true);
});

it("updates an existing distribution with the domain configuration on re-deploy", async () => {
  const commands: unknown[] = [];
  const logs: string[] = [];
  const probes = { dev: 0, live: 0, oac: 0 };
  const existingConfig = {
    CallerReference: "demo-admin-1",
    Comment: "demo-admin",
    Enabled: true,
    HttpVersion: "http2and3",
    PriceClass: "PriceClass_100",
    Aliases: { Quantity: 0 },
    Origins: { Quantity: 0, Items: [] },
    DefaultCacheBehavior: {
      TargetOriginId: "default",
      ViewerProtocolPolicy: "redirect-to-https",
      AllowedMethods: { Quantity: 3, Items: ["GET", "HEAD", "OPTIONS"] },
      CachedMethods: { Quantity: 2, Items: ["GET", "HEAD"] },
      CachePolicyId: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
    },
    CacheBehaviors: { Quantity: 0, Items: [] },
    ViewerCertificate: { CloudFrontDefaultCertificate: true },
  };
  const respond = (command: unknown): unknown => {
    if (command instanceof ListDistributionsCommand) {
      return {
        DistributionList: {
          Items: [
            {
              Id: "DIST1",
              Comment: "demo-admin",
              Enabled: true,
              Status: "Deployed",
              DomainName: "dist.cloudfront.net",
            },
          ],
        },
      };
    }
    if (command instanceof GetDistributionCommand) {
      return {
        Distribution: {
          Id: "DIST1",
          DomainName: "dist.cloudfront.net",
          DistributionConfig: existingConfig,
        },
        ETag: "ET1",
      };
    }
    return stubAws(probes)(command);
  };
  const ctx = createFullContext(commands, respond, logs, {
    dryRun: false,
    adminDomain: "example.com",
    adminCertificateArn: "arn:cert",
  });

  const result = await deployAdmin(ctx, "https://api.example.test");

  expect(result.url).toBe("https://example.com");
  expect(commands.some((command) => command instanceof CreateDistributionCommand)).toBe(false);
  const update = commands.find(
    (command) => command instanceof UpdateDistributionCommand,
  ) as unknown as {
    input: { IfMatch?: string; DistributionConfig?: DomainConfigInput };
  };
  expect(update.input.IfMatch).toBe("ET1");
  expect(update.input.DistributionConfig?.Aliases).toEqual({
    Quantity: 2,
    Items: ["example.com", "www.example.com"],
  });
  expect(update.input.DistributionConfig?.ViewerCertificate).toEqual({
    ACMCertificateArn: "arn:cert",
    SSLSupportMethod: "sni-only",
    MinimumProtocolVersion: "TLSv1.2_2021",
  });
  expect(
    update.input.DistributionConfig?.DefaultCacheBehavior?.FunctionAssociations?.Quantity,
  ).toBe(1);
});

it("upserts Route 53 records in a full run when a hosted zone is configured", async () => {
  const commands: unknown[] = [];
  const probes = { dev: 0, live: 0, oac: 0 };
  const respond = (command: unknown): unknown => {
    if (command instanceof ListHostedZonesByNameCommand) {
      return { HostedZones: [{ Id: "/hostedzone/Z9", Name: "example.com." }] };
    }
    return stubAws(probes)(command);
  };
  const ctx = createFullContext(commands, respond, [], {
    dryRun: false,
    adminDomain: "example.com",
    adminCertificateArn: "arn:cert",
    hostedZone: "example.com",
  });

  await deployAdmin(ctx, "https://api.example.test");

  const change = commands.find((command) => command instanceof ChangeResourceRecordSetsCommand) as
    | { input: { HostedZoneId?: string; ChangeBatch?: { Changes?: unknown[] } } }
    | undefined;
  expect(change?.input.HostedZoneId).toBe("Z9");
  expect(change?.input.ChangeBatch?.Changes).toHaveLength(4);
});

it("deploys with the default certificate while the admin certificate is pending", async () => {
  const commands: unknown[] = [];
  const logs: string[] = [];
  const probes = { dev: 0, live: 0, oac: 0 };
  const ctx = createFullContext(commands, stubAws(probes), logs, {
    dryRun: false,
    adminDomain: "example.com",
  });

  const result = await deployAdmin(ctx, "https://api.example.test");

  expect(result.url).toBe("https://abc123.cloudfront.net");
  const ctxLogs = logs;
  expect(ctxLogs.some((message) => message.includes("not attached yet"))).toBe(true);
  expect(commands.some((command) => command instanceof CreateDistributionCommand)).toBe(true);
  const distribution = commands.find(
    (command) => command instanceof CreateDistributionCommand,
  ) as unknown as { input: { DistributionConfig?: DomainConfigInput } };
  const distConfig = distribution.input.DistributionConfig as DomainConfigInput;
  expect(distConfig.Aliases).toEqual({ Quantity: 0 });
  expect(distConfig.ViewerCertificate).toEqual({ CloudFrontDefaultCertificate: true });
  expect(
    commands.some(
      (command) =>
        command instanceof CreateFunctionCommand ||
        command instanceof ChangeResourceRecordSetsCommand,
    ),
  ).toBe(false);
});

it("wires the admin domain through a dry-run deployment", async () => {
  const commands: unknown[] = [];
  const logs: string[] = [];
  const ctx = createFullContext(commands, () => ({}), logs, {
    dryRun: true,
    adminDomain: "example.com",
    adminCertificateArn: "arn:cert",
    hostedZone: "example.com",
  });

  const result = await deployAdmin(ctx, "https://api.example.test");

  expect(result.url).toBe("https://example.com");
  const ctxLogs = logs;
  expect(
    ctxLogs.some((message) =>
      message.includes("would create CloudFront redirect function demo-admin-redirect"),
    ),
  ).toBe(true);
  expect(
    ctxLogs.some((message) =>
      message.includes("would upsert Route 53 alias records for example.com, www.example.com"),
    ),
  ).toBe(true);
  expect(
    commands.some(
      (command) =>
        command instanceof CreateFunctionCommand ||
        command instanceof UpdateFunctionCommand ||
        command instanceof PublishFunctionCommand ||
        command instanceof ChangeResourceRecordSetsCommand ||
        command instanceof CreateDistributionCommand,
    ),
  ).toBe(false);
});
