import {
  CreateLogGroupCommand,
  DeleteLogGroupCommand,
  DescribeResourcePoliciesCommand,
  PutResourcePolicyCommand,
  PutRetentionPolicyCommand,
  TagResourceCommand,
} from "@aws-sdk/client-cloudwatch-logs";

import type { DeployContext } from "../deploy/context.ts";
import { isAwsError } from "../util/aws.ts";
import { deploymentTags } from "./tags.ts";

/** Default number of days Lambda logs are kept. */
export const DEFAULT_LOG_RETENTION = 30;

/** Default number of days API Gateway access logs are kept. */
export const DEFAULT_ACCESS_LOG_RETENTION = 14;

/** Structured API Gateway access log format; it never includes bodies or credentials. */
export const API_GATEWAY_ACCESS_LOG_FORMAT = JSON.stringify({
  requestId: "$context.requestId",
  requestTime: "$context.requestTime",
  httpMethod: "$context.httpMethod",
  routeKey: "$context.routeKey",
  status: "$context.status",
  protocol: "$context.protocol",
  responseLength: "$context.responseLength",
  sourceIp: "$context.identity.sourceIp",
  integrationStatus: "$context.integration.integrationStatus",
  integrationLatency: "$context.integration.latency",
  responseLatency: "$context.responseLatency",
  errorMessage: "$context.error.message",
});

/** Retention values accepted by CloudWatch Logs. */
const VALID_RETENTIONS = new Set([
  1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288,
  3653,
]);

/** Validates a retention period and returns it as a number. */
export function validateLogRetention(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Log retention must be a whole number of days of at least 1, got ${value}.`);
  }
  if (!VALID_RETENTIONS.has(value)) {
    throw new Error(
      `Log retention must be one of ${[...VALID_RETENTIONS].join(", ")} days, got ${value}.`,
    );
  }
  return value;
}

/** CloudWatch log group that Lambda creates for a function. */
export function lambdaLogGroupName(functionName: string): string {
  return `/aws/lambda/${functionName}`;
}

/** ARN of a CloudWatch Logs log group. */
export function logGroupArn(ctx: DeployContext, logGroupName: string): string {
  return `arn:aws:logs:${ctx.region}:${ctx.accountId}:log-group:${logGroupName}`;
}

/** Creates a log group when needed and applies the retention period. */
export async function ensureLogGroupNamed(
  ctx: DeployContext,
  logGroupName: string,
  retentionDays: number,
): Promise<void> {
  if (ctx.dryRun) {
    ctx.log(`would create log group ${logGroupName} with ${retentionDays}-day retention`);
    return;
  }

  try {
    await ctx.clients.logs.send(new CreateLogGroupCommand({ logGroupName }));
  } catch (error) {
    if (!isAwsError(error, "ResourceAlreadyExistsException")) {
      throw error;
    }
  }
  await ctx.clients.logs.send(
    new PutRetentionPolicyCommand({ logGroupName, retentionInDays: retentionDays }),
  );
  await ctx.clients.logs.send(
    new TagResourceCommand({
      resourceArn: logGroupArn(ctx, logGroupName),
      tags: deploymentTags(ctx.appPrefix),
    }),
  );
  ctx.log(`log group ${logGroupName} retains logs for ${retentionDays} days`);
}

/** Creates the Lambda log group when needed and applies the retention period. */
export async function ensureLogGroup(
  ctx: DeployContext,
  functionName: string,
  retentionDays: number,
): Promise<void> {
  await ensureLogGroupNamed(ctx, lambdaLogGroupName(functionName), retentionDays);
}

/** Deletes a log group, ignoring one that no longer exists. */
export async function deleteLogGroupNamed(ctx: DeployContext, logGroupName: string): Promise<void> {
  if (ctx.dryRun) {
    ctx.log(`would delete log group ${logGroupName}`);
    return;
  }
  try {
    await ctx.clients.logs.send(new DeleteLogGroupCommand({ logGroupName }));
    ctx.log(`deleted log group ${logGroupName}`);
  } catch (error) {
    if (!isAwsError(error, "ResourceNotFoundException")) {
      throw error;
    }
  }
}

/** Deletes a deployment's Lambda log group, ignoring one that no longer exists. */
export async function deleteLogGroup(ctx: DeployContext, functionName: string): Promise<void> {
  await deleteLogGroupNamed(ctx, lambdaLogGroupName(functionName));
}

/** Grants API Gateway permission to write access logs to the deployment log group. */
async function ensureAccessLogResourcePolicy(
  ctx: DeployContext,
  logGroupName: string,
  apiId: string,
): Promise<void> {
  const arn = logGroupArn(ctx, logGroupName);
  const policyName = `${ctx.appPrefix}-api-access`;
  const policyDocument = JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "AllowApiGatewayAccessLogs",
        Effect: "Allow",
        Principal: { Service: "apigateway.amazonaws.com" },
        Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
        Resource: `${arn}:*`,
        Condition: {
          ArnLike: {
            "aws:SourceArn": `arn:aws:execute-api:${ctx.region}:${ctx.accountId}:${apiId}/*`,
          },
          StringEquals: { "aws:SourceAccount": ctx.accountId },
        },
      },
    ],
  });

  const existing = await ctx.clients.logs.send(
    new DescribeResourcePoliciesCommand({
      resourceArn: arn,
      policyScope: "RESOURCE",
    }),
  );
  const current = (existing.resourcePolicies ?? []).find(
    (policy) => policy.policyName === policyName,
  );
  if (current?.policyDocument === policyDocument) {
    return;
  }

  await ctx.clients.logs.send(
    new PutResourcePolicyCommand({
      policyName,
      policyDocument,
      resourceArn: arn,
      // CloudWatch Logs uses null when creating a resource-scoped policy for the first time.
      expectedRevisionId: current?.revisionId ?? (null as unknown as string),
    }),
  );
}

/**
 * Creates the API Gateway access log group with bounded retention and the resource policy API
 * Gateway needs to write to it.
 */
export async function ensureApiGatewayAccessLogs(
  ctx: DeployContext,
  logGroupName: string,
  apiId: string,
): Promise<{ destinationArn: string; format: string }> {
  const destinationArn = logGroupArn(ctx, logGroupName);

  if (ctx.dryRun) {
    ctx.log(
      `would create log group ${logGroupName} with ${DEFAULT_ACCESS_LOG_RETENTION}-day retention and enable API Gateway access logs`,
    );
    return { destinationArn, format: API_GATEWAY_ACCESS_LOG_FORMAT };
  }

  await ensureLogGroupNamed(ctx, logGroupName, DEFAULT_ACCESS_LOG_RETENTION);
  await ensureAccessLogResourcePolicy(ctx, logGroupName, apiId);
  ctx.log(`API Gateway access logs write to ${logGroupName}`);
  return { destinationArn, format: API_GATEWAY_ACCESS_LOG_FORMAT };
}
