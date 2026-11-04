import { AddTagsToCertificateCommand } from "@aws-sdk/client-acm";
import { TagResourceCommand as ApiGatewayTagResourceCommand } from "@aws-sdk/client-apigatewayv2";
import { TagResourceCommand as CloudFrontTagResourceCommand } from "@aws-sdk/client-cloudfront";
import { TagResourceCommand as DynamoDbTagResourceCommand } from "@aws-sdk/client-dynamodb";
import { TagRoleCommand } from "@aws-sdk/client-iam";
import { TagResourceCommand as LambdaTagResourceCommand } from "@aws-sdk/client-lambda";
import { PutBucketTaggingCommand } from "@aws-sdk/client-s3";
import { TagResourceCommand as SesTagResourceCommand } from "@aws-sdk/client-sesv2";
import { TagQueueCommand } from "@aws-sdk/client-sqs";
import { expect, it } from "vitest";

import type { AwsClients } from "./clients.ts";
import type { DeployContext } from "../deploy/context.ts";
import {
  apiGatewayArn,
  cloudFrontArn,
  cloudFrontTagSet,
  deploymentTagList,
  deploymentTags,
  dynamoTableArn,
  lambdaFunctionArn,
  sesIdentityArn,
  tagApiGatewayResource,
  tagBucket,
  tagCertificate,
  tagCloudFrontResource,
  tagDynamoTable,
  tagEmailIdentity,
  tagLambdaFunction,
  tagQueue,
  tagRole,
} from "./tags.ts";

const noop = (): void => undefined;

function createContext(
  send: (command: unknown) => Promise<unknown>,
  dryRun = false,
): DeployContext {
  const client = { send };
  return {
    region: "eu-west-1",
    accountId: "111122223333",
    dryRun,
    repoRoot: ".",
    appPrefix: "demo",
    mediaBucket: "demo-media",
    log: noop,
    clients: {
      s3: client,
      dynamodb: client,
      sqs: client,
      iam: client,
      lambda: client,
      cloudfront: client,
      apiGateway: client,
      acm: client,
      ses: client,
    } as unknown as AwsClients,
  };
}

async function capture(command: (ctx: DeployContext) => Promise<void>): Promise<unknown> {
  const commands: unknown[] = [];
  const ctx = createContext(async (sent) => {
    commands.push(sent);
    return {};
  });
  await command(ctx);
  expect(commands).toHaveLength(1);
  return commands[0];
}

it("builds the documented tag map, list, and CloudFront shape", () => {
  expect(deploymentTags("demo")).toEqual({
    "provisionless:managed": "true",
    "provisionless:app": "demo",
  });
  expect(deploymentTagList("demo")).toEqual([
    { Key: "provisionless:managed", Value: "true" },
    { Key: "provisionless:app", Value: "demo" },
  ]);
  expect(cloudFrontTagSet("demo")).toEqual({
    Items: [
      { Key: "provisionless:managed", Value: "true" },
      { Key: "provisionless:app", Value: "demo" },
    ],
  });
});

it("builds service ARNs", () => {
  const ctx = createContext(async () => ({}));
  expect(dynamoTableArn(ctx, "demo-users")).toBe(
    "arn:aws:dynamodb:eu-west-1:111122223333:table/demo-users",
  );
  expect(lambdaFunctionArn(ctx, "demo-api")).toBe(
    "arn:aws:lambda:eu-west-1:111122223333:function:demo-api",
  );
  expect(apiGatewayArn(ctx, "/apis/api1")).toBe("arn:aws:apigateway:eu-west-1::/apis/api1");
  expect(cloudFrontArn(ctx, "distribution/DIST1")).toBe(
    "arn:aws:cloudfront::111122223333:distribution/DIST1",
  );
  expect(sesIdentityArn(ctx, "no-reply@example.com")).toBe(
    "arn:aws:ses:eu-west-1:111122223333:identity/no-reply@example.com",
  );
});

it("tags S3 buckets", async () => {
  const command = (await capture((ctx) => tagBucket(ctx, "demo-media"))) as PutBucketTaggingCommand;
  expect(command).toBeInstanceOf(PutBucketTaggingCommand);
  expect(command.input).toEqual({
    Bucket: "demo-media",
    Tagging: { TagSet: deploymentTagList("demo") },
  });
});

it("tags DynamoDB tables", async () => {
  const command = (await capture((ctx) =>
    tagDynamoTable(ctx, "demo-users"),
  )) as DynamoDbTagResourceCommand;
  expect(command).toBeInstanceOf(DynamoDbTagResourceCommand);
  expect(command.input).toEqual({
    ResourceArn: "arn:aws:dynamodb:eu-west-1:111122223333:table/demo-users",
    Tags: deploymentTagList("demo"),
  });
});

it("tags SQS queues", async () => {
  const command = (await capture((ctx) =>
    tagQueue(ctx, "https://sqs.eu-west-1.amazonaws.com/111122223333/demo"),
  )) as TagQueueCommand;
  expect(command).toBeInstanceOf(TagQueueCommand);
  expect(command.input).toEqual({
    QueueUrl: "https://sqs.eu-west-1.amazonaws.com/111122223333/demo",
    Tags: deploymentTags("demo"),
  });
});

it("tags IAM roles", async () => {
  const command = (await capture((ctx) => tagRole(ctx, "demo-api-role"))) as TagRoleCommand;
  expect(command).toBeInstanceOf(TagRoleCommand);
  expect(command.input).toEqual({
    RoleName: "demo-api-role",
    Tags: deploymentTagList("demo"),
  });
});

it("tags Lambda functions", async () => {
  const command = (await capture((ctx) =>
    tagLambdaFunction(ctx, "demo-api"),
  )) as LambdaTagResourceCommand;
  expect(command).toBeInstanceOf(LambdaTagResourceCommand);
  expect(command.input).toEqual({
    Resource: "arn:aws:lambda:eu-west-1:111122223333:function:demo-api",
    Tags: deploymentTags("demo"),
  });
});

it("tags CloudFront resources", async () => {
  const command = (await capture((ctx) =>
    tagCloudFrontResource(ctx, "arn:aws:cloudfront::111122223333:distribution/DIST1"),
  )) as CloudFrontTagResourceCommand;
  expect(command).toBeInstanceOf(CloudFrontTagResourceCommand);
  expect(command.input).toEqual({
    Resource: "arn:aws:cloudfront::111122223333:distribution/DIST1",
    Tags: cloudFrontTagSet("demo"),
  });
});

it("tags API Gateway resources", async () => {
  const command = (await capture((ctx) =>
    tagApiGatewayResource(ctx, "arn:aws:apigateway:eu-west-1::/apis/api1"),
  )) as ApiGatewayTagResourceCommand;
  expect(command).toBeInstanceOf(ApiGatewayTagResourceCommand);
  expect(command.input).toEqual({
    ResourceArn: "arn:aws:apigateway:eu-west-1::/apis/api1",
    Tags: deploymentTags("demo"),
  });
});

it("tags ACM certificates and SES identities", async () => {
  const certificate = (await capture((ctx) =>
    tagCertificate(ctx, "arn:aws:acm:eu-west-1:111122223333:certificate/abc"),
  )) as AddTagsToCertificateCommand;
  expect(certificate).toBeInstanceOf(AddTagsToCertificateCommand);
  expect(certificate.input).toEqual({
    CertificateArn: "arn:aws:acm:eu-west-1:111122223333:certificate/abc",
    Tags: deploymentTagList("demo"),
  });

  const identity = (await capture((ctx) =>
    tagEmailIdentity(ctx, "no-reply@example.com"),
  )) as SesTagResourceCommand;
  expect(identity).toBeInstanceOf(SesTagResourceCommand);
  expect(identity.input).toEqual({
    ResourceArn: "arn:aws:ses:eu-west-1:111122223333:identity/no-reply@example.com",
    Tags: deploymentTagList("demo"),
  });
});

it("does not tag anything during a dry run", async () => {
  const commands: unknown[] = [];
  const ctx = createContext(async (command) => {
    commands.push(command);
    return {};
  }, true);

  await tagBucket(ctx, "demo-media");
  await tagDynamoTable(ctx, "demo-users");
  await tagQueue(ctx, "https://sqs.example.com/q");
  await tagRole(ctx, "demo-role");
  await tagLambdaFunction(ctx, "demo-api");
  await tagCloudFrontResource(ctx, "arn:aws:cloudfront::111122223333:distribution/D1");
  await tagApiGatewayResource(ctx, "arn:aws:apigateway:eu-west-1::/apis/api1");
  await tagCertificate(ctx, "arn:aws:acm:eu-west-1:111122223333:certificate/abc");
  await tagEmailIdentity(ctx, "no-reply@example.com");

  expect(commands).toEqual([]);
});
