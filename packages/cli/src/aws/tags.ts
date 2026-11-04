import { AddTagsToCertificateCommand } from "@aws-sdk/client-acm";
import { TagResourceCommand as ApiGatewayTagResourceCommand } from "@aws-sdk/client-apigatewayv2";
import { TagResourceCommand as CloudFrontTagResourceCommand } from "@aws-sdk/client-cloudfront";
import { TagResourceCommand as DynamoDbTagResourceCommand } from "@aws-sdk/client-dynamodb";
import { TagRoleCommand } from "@aws-sdk/client-iam";
import { TagResourceCommand as LambdaTagResourceCommand } from "@aws-sdk/client-lambda";
import { PutBucketTaggingCommand } from "@aws-sdk/client-s3";
import { TagResourceCommand as SesTagResourceCommand } from "@aws-sdk/client-sesv2";
import { TagQueueCommand } from "@aws-sdk/client-sqs";

import type { DeployContext } from "../deploy/context.ts";

/** A tag as most AWS APIs expect it. */
export interface AwsTag {
  Key: string;
  Value: string;
}

/** Marks every resource Provisionless manages. */
export const MANAGED_TAG_KEY = "provisionless:managed";

/** Identifies the deployment (app prefix) a resource belongs to. */
export const APP_TAG_KEY = "provisionless:app";

/** Tags for APIs that accept a key/value map (Lambda, API Gateway, SQS, SES). */
export function deploymentTags(appPrefix: string): Record<string, string> {
  return { [MANAGED_TAG_KEY]: "true", [APP_TAG_KEY]: appPrefix };
}

/** Tags for APIs that accept a list of `{ Key, Value }` objects (IAM, ACM, DynamoDB, S3). */
export function deploymentTagList(appPrefix: string): AwsTag[] {
  return Object.entries(deploymentTags(appPrefix)).map(([Key, Value]) => ({ Key, Value }));
}

/** Tags for CloudFront, which wraps the list in an `Items` object. */
export function cloudFrontTagSet(appPrefix: string): { Items: AwsTag[] } {
  return { Items: deploymentTagList(appPrefix) };
}

export function dynamoTableArn(ctx: DeployContext, tableName: string): string {
  return `arn:aws:dynamodb:${ctx.region}:${ctx.accountId}:table/${tableName}`;
}

export function lambdaFunctionArn(ctx: DeployContext, functionName: string): string {
  return `arn:aws:lambda:${ctx.region}:${ctx.accountId}:function:${functionName}`;
}

export function apiGatewayArn(ctx: DeployContext, path: string): string {
  return `arn:aws:apigateway:${ctx.region}::${path}`;
}

export function cloudFrontArn(ctx: DeployContext, path: string): string {
  return `arn:aws:cloudfront::${ctx.accountId}:${path}`;
}

export function sesIdentityArn(ctx: DeployContext, identity: string): string {
  return `arn:aws:ses:${ctx.region}:${ctx.accountId}:identity/${identity}`;
}

export async function tagBucket(ctx: DeployContext, bucket: string): Promise<void> {
  if (ctx.dryRun) {
    return;
  }
  await ctx.clients.s3.send(
    new PutBucketTaggingCommand({
      Bucket: bucket,
      Tagging: { TagSet: deploymentTagList(ctx.appPrefix) },
    }),
  );
}

export async function tagDynamoTable(ctx: DeployContext, tableName: string): Promise<void> {
  if (ctx.dryRun) {
    return;
  }
  await ctx.clients.dynamodb.send(
    new DynamoDbTagResourceCommand({
      ResourceArn: dynamoTableArn(ctx, tableName),
      Tags: deploymentTagList(ctx.appPrefix),
    }),
  );
}

export async function tagQueue(ctx: DeployContext, queueUrl: string): Promise<void> {
  if (ctx.dryRun) {
    return;
  }
  await ctx.clients.sqs.send(
    new TagQueueCommand({ QueueUrl: queueUrl, Tags: deploymentTags(ctx.appPrefix) }),
  );
}

export async function tagRole(ctx: DeployContext, roleName: string): Promise<void> {
  if (ctx.dryRun) {
    return;
  }
  await ctx.clients.iam.send(
    new TagRoleCommand({ RoleName: roleName, Tags: deploymentTagList(ctx.appPrefix) }),
  );
}

export async function tagLambdaFunction(ctx: DeployContext, functionName: string): Promise<void> {
  if (ctx.dryRun) {
    return;
  }
  await ctx.clients.lambda.send(
    new LambdaTagResourceCommand({
      Resource: lambdaFunctionArn(ctx, functionName),
      Tags: deploymentTags(ctx.appPrefix),
    }),
  );
}

export async function tagCloudFrontResource(
  ctx: DeployContext,
  resourceArn: string,
): Promise<void> {
  if (ctx.dryRun) {
    return;
  }
  await ctx.clients.cloudfront.send(
    new CloudFrontTagResourceCommand({
      Resource: resourceArn,
      Tags: cloudFrontTagSet(ctx.appPrefix),
    }),
  );
}

export async function tagApiGatewayResource(
  ctx: DeployContext,
  resourceArn: string,
): Promise<void> {
  if (ctx.dryRun) {
    return;
  }
  await ctx.clients.apiGateway.send(
    new ApiGatewayTagResourceCommand({
      ResourceArn: resourceArn,
      Tags: deploymentTags(ctx.appPrefix),
    }),
  );
}

export async function tagCertificate(ctx: DeployContext, certificateArn: string): Promise<void> {
  if (ctx.dryRun) {
    return;
  }
  await ctx.clients.acm.send(
    new AddTagsToCertificateCommand({
      CertificateArn: certificateArn,
      Tags: deploymentTagList(ctx.appPrefix),
    }),
  );
}

export async function tagEmailIdentity(ctx: DeployContext, identity: string): Promise<void> {
  if (ctx.dryRun) {
    return;
  }
  await ctx.clients.ses.send(
    new SesTagResourceCommand({
      ResourceArn: sesIdentityArn(ctx, identity),
      Tags: deploymentTagList(ctx.appPrefix),
    }),
  );
}
