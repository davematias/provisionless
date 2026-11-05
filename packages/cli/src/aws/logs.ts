import {
  CreateLogGroupCommand,
  DeleteLogGroupCommand,
  PutRetentionPolicyCommand,
  TagResourceCommand,
} from "@aws-sdk/client-cloudwatch-logs";

import type { DeployContext } from "../deploy/context.ts";
import { isAwsError } from "../util/aws.ts";
import { deploymentTags } from "./tags.ts";

/** Default number of days Lambda logs are kept. */
export const DEFAULT_LOG_RETENTION = 30;

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

/** Creates the Lambda log group when needed and applies the retention period. */
export async function ensureLogGroup(
  ctx: DeployContext,
  functionName: string,
  retentionDays: number,
): Promise<void> {
  const logGroupName = lambdaLogGroupName(functionName);
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
      resourceArn: `arn:aws:logs:${ctx.region}:${ctx.accountId}:log-group:${logGroupName}`,
      tags: deploymentTags(ctx.appPrefix),
    }),
  );
  ctx.log(`log group ${logGroupName} retains logs for ${retentionDays} days`);
}

/** Deletes a deployment's Lambda log group, ignoring one that no longer exists. */
export async function deleteLogGroup(ctx: DeployContext, functionName: string): Promise<void> {
  const logGroupName = lambdaLogGroupName(functionName);
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
