import type { BucketLocationConstraint } from "@aws-sdk/client-s3";
import { CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";

import type { DeployContext } from "../deploy/context.ts";
import { isAwsError } from "../util/aws.ts";

export async function ensureBucket(ctx: DeployContext, bucket: string): Promise<void> {
  try {
    await ctx.clients.s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return;
  } catch (error) {
    const notFound =
      isAwsError(error, "NotFound") ||
      isAwsError(error, "NoSuchBucket") ||
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404;
    if (!notFound) {
      throw error;
    }
  }

  if (ctx.dryRun) {
    ctx.log(`would create S3 bucket ${bucket}`);
    return;
  }

  ctx.log(`creating S3 bucket ${bucket}`);
  await ctx.clients.s3.send(
    new CreateBucketCommand({
      Bucket: bucket,
      CreateBucketConfiguration:
        ctx.region === "us-east-1"
          ? undefined
          : { LocationConstraint: ctx.region as BucketLocationConstraint },
    }),
  );
}
