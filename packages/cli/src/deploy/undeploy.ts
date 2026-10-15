import { DeleteCertificateCommand, type ACMClient } from "@aws-sdk/client-acm";
import {
  DeleteApiCommand,
  DeleteApiMappingCommand,
  DeleteDomainNameCommand,
  GetApiMappingsCommand,
  GetApisCommand,
  GetDomainNamesCommand,
} from "@aws-sdk/client-apigatewayv2";
import type { DistributionConfig } from "@aws-sdk/client-cloudfront";
import {
  DeleteDistributionCommand,
  DeleteFunctionCommand as DeleteCloudFrontFunctionCommand,
  DeleteOriginAccessControlCommand,
  DescribeFunctionCommand,
  GetDistributionCommand,
  GetOriginAccessControlCommand,
  ListDistributionsCommand,
  ListOriginAccessControlsCommand,
  UpdateDistributionCommand,
} from "@aws-sdk/client-cloudfront";
import { DeleteTableCommand, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import {
  DeleteRoleCommand,
  DeleteRolePolicyCommand,
  DetachRolePolicyCommand,
  GetRoleCommand,
} from "@aws-sdk/client-iam";
import {
  DeleteEventSourceMappingCommand,
  DeleteFunctionCommand,
  GetFunctionCommand,
  ListEventSourceMappingsCommand,
} from "@aws-sdk/client-lambda";
import {
  DeleteBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { DeleteQueueCommand, GetQueueUrlCommand } from "@aws-sdk/client-sqs";
import { GetCallerIdentityCommand } from "@aws-sdk/client-sts";

import { createAwsClients } from "../aws/clients.ts";
import { adminSiteNames } from "../aws/domains.ts";
import { adminNames, apiNames } from "../aws/names.ts";
import {
  deleteRecords,
  listDomainRecords,
  pickDomainRecords,
  resolveHostedZoneId,
} from "../aws/route53.ts";
import { loadConfig, resolveAppPrefix, resolveRegion } from "../config/config.ts";
import { isAwsError, sleep } from "../util/aws.ts";
import { createLogger } from "../util/log.ts";
import { confirm, createPrompter } from "../util/prompt.ts";
import { findRepoRoot } from "../util/repo.ts";
import type { DeployContext } from "./context.ts";

const BASIC_EXECUTION_POLICY = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole";

export interface UndeployOptions {
  region?: string;
  prefix?: string;
  keepData?: boolean;
  yes: boolean;
  dryRun: boolean;
}

async function deleteLambda(ctx: DeployContext, name: string): Promise<void> {
  try {
    await ctx.clients.lambda.send(new GetFunctionCommand({ FunctionName: name }));
  } catch (error) {
    if (isAwsError(error, "ResourceNotFoundException")) {
      ctx.log(`no Lambda ${name}`);
      return;
    }
    throw error;
  }

  if (ctx.dryRun) {
    ctx.log(`would delete Lambda ${name}`);
    return;
  }

  const mappings = await ctx.clients.lambda.send(
    new ListEventSourceMappingsCommand({ FunctionName: name }),
  );
  for (const mapping of mappings.EventSourceMappings ?? []) {
    if (mapping.UUID) {
      await ctx.clients.lambda.send(new DeleteEventSourceMappingCommand({ UUID: mapping.UUID }));
    }
  }

  await ctx.clients.lambda.send(new DeleteFunctionCommand({ FunctionName: name }));
  ctx.log(`deleted Lambda ${name}`);
}

async function deleteHttpApi(ctx: DeployContext, name: string): Promise<void> {
  const apis = await ctx.clients.apiGateway.send(new GetApisCommand({}));
  const api = apis.Items?.find((item) => item.Name === name);
  if (!api?.ApiId) {
    ctx.log(`no API Gateway HTTP API ${name}`);
    return;
  }

  if (ctx.dryRun) {
    ctx.log(`would delete API Gateway HTTP API ${name}`);
    return;
  }

  await ctx.clients.apiGateway.send(new DeleteApiCommand({ ApiId: api.ApiId }));
  ctx.log(`deleted API Gateway HTTP API ${name}`);
}

async function deleteQueue(ctx: DeployContext, queueName: string): Promise<void> {
  let queueUrl: string | undefined;
  try {
    const result = await ctx.clients.sqs.send(new GetQueueUrlCommand({ QueueName: queueName }));
    queueUrl = result.QueueUrl;
  } catch (error) {
    if (
      !isAwsError(error, "QueueDoesNotExist") &&
      !isAwsError(error, "AWS.SimpleQueueService.NonExistentQueue")
    ) {
      throw error;
    }
  }

  if (!queueUrl) {
    ctx.log(`no SQS queue ${queueName}`);
    return;
  }
  if (ctx.dryRun) {
    ctx.log(`would delete SQS queue ${queueName}`);
    return;
  }

  await ctx.clients.sqs.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
  ctx.log(`deleted SQS queue ${queueName}`);
}

async function deleteTable(ctx: DeployContext, tableName: string): Promise<void> {
  try {
    await ctx.clients.dynamodb.send(new DescribeTableCommand({ TableName: tableName }));
  } catch (error) {
    if (isAwsError(error, "ResourceNotFoundException")) {
      ctx.log(`no DynamoDB table ${tableName}`);
      return;
    }
    throw error;
  }

  if (ctx.dryRun) {
    ctx.log(`would delete DynamoDB table ${tableName}`);
    return;
  }

  await ctx.clients.dynamodb.send(new DeleteTableCommand({ TableName: tableName }));
  ctx.log(`deleted DynamoDB table ${tableName}`);
}

async function emptyAndDeleteBucket(ctx: DeployContext, bucket: string): Promise<void> {
  try {
    await ctx.clients.s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    const notFound =
      isAwsError(error, "NotFound") ||
      isAwsError(error, "NoSuchBucket") ||
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404;
    if (notFound) {
      ctx.log(`no S3 bucket ${bucket}`);
      return;
    }
    throw error;
  }

  if (ctx.dryRun) {
    ctx.log(`would empty and delete S3 bucket ${bucket}`);
    return;
  }

  let continuationToken: string | undefined;
  do {
    const listed = await ctx.clients.s3.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }),
    );
    const objects = (listed.Contents ?? []).map((object) => ({ Key: object.Key ?? "" }));
    if (objects.length > 0) {
      await ctx.clients.s3.send(
        new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }),
      );
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);

  await ctx.clients.s3.send(new DeleteBucketCommand({ Bucket: bucket }));
  ctx.log(`deleted S3 bucket ${bucket}`);
}

async function deleteOac(ctx: DeployContext, name: string): Promise<void> {
  const listed = await ctx.clients.cloudfront.send(new ListOriginAccessControlsCommand({}));
  const oac = (listed.OriginAccessControlList?.Items ?? []).find((item) => item.Name === name);
  if (!oac?.Id) {
    ctx.log(`no CloudFront origin access control ${name}`);
    return;
  }

  if (ctx.dryRun) {
    ctx.log(`would delete CloudFront origin access control ${name}`);
    return;
  }

  const detail = await ctx.clients.cloudfront.send(
    new GetOriginAccessControlCommand({ Id: oac.Id }),
  );
  await ctx.clients.cloudfront.send(
    new DeleteOriginAccessControlCommand({ Id: oac.Id, IfMatch: detail.ETag }),
  );
  ctx.log(`deleted CloudFront origin access control ${name}`);
}

async function deleteRole(ctx: DeployContext, roleName: string, policyName: string): Promise<void> {
  try {
    await ctx.clients.iam.send(new GetRoleCommand({ RoleName: roleName }));
  } catch (error) {
    if (isAwsError(error, "NoSuchEntityException") || isAwsError(error, "NoSuchEntity")) {
      ctx.log(`no IAM role ${roleName}`);
      return;
    }
    throw error;
  }

  if (ctx.dryRun) {
    ctx.log(`would delete IAM role ${roleName}`);
    return;
  }

  try {
    await ctx.clients.iam.send(
      new DeleteRolePolicyCommand({ RoleName: roleName, PolicyName: policyName }),
    );
  } catch (error) {
    if (!isAwsError(error, "NoSuchEntityException") && !isAwsError(error, "NoSuchEntity")) {
      throw error;
    }
  }

  try {
    await ctx.clients.iam.send(
      new DetachRolePolicyCommand({ RoleName: roleName, PolicyArn: BASIC_EXECUTION_POLICY }),
    );
  } catch (error) {
    if (!isAwsError(error, "NoSuchEntityException") && !isAwsError(error, "NoSuchEntity")) {
      throw error;
    }
  }

  await ctx.clients.iam.send(new DeleteRoleCommand({ RoleName: roleName }));
  ctx.log(`deleted IAM role ${roleName}`);
}

async function findDistribution(
  ctx: DeployContext,
  comment: string,
): Promise<{ id: string; eTag?: string; config: DistributionConfig } | undefined> {
  const listed = await ctx.clients.cloudfront.send(new ListDistributionsCommand({}));
  const found = listed.DistributionList?.Items?.find((item) => item.Comment === comment);
  if (!found?.Id) {
    return undefined;
  }
  const detail = await ctx.clients.cloudfront.send(new GetDistributionCommand({ Id: found.Id }));
  const distribution = detail.Distribution;
  if (!distribution?.DistributionConfig) {
    return undefined;
  }
  return { id: found.Id, eTag: detail.ETag, config: distribution.DistributionConfig };
}

async function waitForDistributionDeployed(ctx: DeployContext, id: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await ctx.clients.cloudfront.send(new GetDistributionCommand({ Id: id }));
    if (result.Distribution?.Status === "Deployed") {
      return;
    }
    await sleep(15000);
  }
  throw new Error(`Timed out waiting for CloudFront distribution ${id} to deploy`);
}

async function deleteDistribution(ctx: DeployContext, comment: string): Promise<void> {
  const found = await findDistribution(ctx, comment);
  if (!found) {
    ctx.log(`no CloudFront distribution ${comment}`);
    return;
  }

  if (ctx.dryRun) {
    ctx.log(`would disable and delete CloudFront distribution ${found.id}`);
    return;
  }

  ctx.log(`disabling CloudFront distribution ${found.id} (this can take several minutes)`);
  const disabled = await ctx.clients.cloudfront.send(
    new UpdateDistributionCommand({
      Id: found.id,
      IfMatch: found.eTag,
      DistributionConfig: { ...found.config, Enabled: false },
    }),
  );
  if (!disabled.ETag) {
    throw new Error("CloudFront did not return an ETag while disabling");
  }

  await waitForDistributionDeployed(ctx, found.id);

  const current = await ctx.clients.cloudfront.send(new GetDistributionCommand({ Id: found.id }));
  await ctx.clients.cloudfront.send(
    new DeleteDistributionCommand({ Id: found.id, IfMatch: current.ETag }),
  );
  ctx.log(`deleted CloudFront distribution ${found.id}`);
}

async function deleteRedirectFunction(ctx: DeployContext, name: string): Promise<void> {
  let etag: string | undefined;
  try {
    const described = await ctx.clients.cloudfront.send(
      new DescribeFunctionCommand({ Name: name, Stage: "DEVELOPMENT" }),
    );
    etag = described.ETag;
  } catch (error) {
    if (isAwsError(error, "NoSuchFunctionExists")) {
      ctx.log(`no CloudFront redirect function ${name}`);
      return;
    }
    throw error;
  }

  if (ctx.dryRun) {
    ctx.log(`would delete CloudFront redirect function ${name}`);
    return;
  }

  await ctx.clients.cloudfront.send(
    new DeleteCloudFrontFunctionCommand({ Name: name, IfMatch: etag }),
  );
  ctx.log(`deleted CloudFront redirect function ${name}`);
}

async function deleteApiCustomDomain(ctx: DeployContext): Promise<void> {
  const domain = ctx.apiDomain;
  if (!domain) {
    return;
  }

  const listed = await ctx.clients.apiGateway.send(new GetDomainNamesCommand({}));
  const found = listed.Items?.find((item) => item.DomainName === domain);
  if (!found) {
    ctx.log(`no API Gateway custom domain ${domain}`);
    return;
  }

  if (ctx.dryRun) {
    ctx.log(`would delete API Gateway custom domain ${domain} and its mappings`);
    return;
  }

  const mappings = await ctx.clients.apiGateway.send(
    new GetApiMappingsCommand({ DomainName: domain }),
  );
  for (const mapping of mappings.Items ?? []) {
    if (mapping.ApiMappingId) {
      await ctx.clients.apiGateway.send(
        new DeleteApiMappingCommand({ ApiMappingId: mapping.ApiMappingId, DomainName: domain }),
      );
    }
  }
  await ctx.clients.apiGateway.send(new DeleteDomainNameCommand({ DomainName: domain }));
  ctx.log(`deleted API Gateway custom domain ${domain}`);
}

async function deleteRoute53DomainRecords(ctx: DeployContext): Promise<void> {
  if (!ctx.hostedZone) {
    return;
  }
  const managedNames = domainManagedNames(ctx);
  if (managedNames.length === 0) {
    return;
  }

  const hostedZoneId = await resolveHostedZoneId(ctx.clients.route53, ctx.hostedZone);
  const records = await listDomainRecords(ctx.clients.route53, hostedZoneId);
  const matching = pickDomainRecords(records, managedNames);
  if (matching.length === 0) {
    ctx.log(`no Route 53 domain records to delete for ${managedNames.join(", ")}`);
    return;
  }

  if (ctx.dryRun) {
    for (const record of matching) {
      ctx.log(`would delete Route 53 record ${record.Name} (${record.Type})`);
    }
    return;
  }

  await deleteRecords(ctx.clients.route53, hostedZoneId, matching);
  ctx.log(`deleted ${matching.length} Route 53 domain records`);
}

async function deleteCertificate(
  ctx: DeployContext,
  arn: string,
  label: string,
  client: ACMClient,
): Promise<void> {
  if (ctx.dryRun) {
    ctx.log(`would delete ACM certificate ${arn} (${label})`);
    return;
  }

  try {
    await client.send(new DeleteCertificateCommand({ CertificateArn: arn }));
  } catch (error) {
    if (isAwsError(error, "ResourceInUseException")) {
      ctx.log(`ACM certificate ${arn} (${label}) is still in use; re-run undeploy to remove it`);
      return;
    }
    if (isAwsError(error, "ResourceNotFoundException")) {
      ctx.log(`no ACM certificate ${arn} (${label})`);
      return;
    }
    throw error;
  }
  ctx.log(
    `deleted ACM certificate ${arn} (${label}); archived for 7 days before permanent deletion`,
  );
}

async function deleteAcmCertificates(ctx: DeployContext): Promise<void> {
  if (ctx.adminCertificateArn) {
    await deleteCertificate(ctx, ctx.adminCertificateArn, "admin", ctx.clients.acmUsEast1);
  }
  if (ctx.apiCertificateArn) {
    await deleteCertificate(ctx, ctx.apiCertificateArn, "api", ctx.clients.acm);
  }
}

export function domainManagedNames(ctx: DeployContext): string[] {
  return [
    ...(ctx.adminDomain ? adminSiteNames(ctx.adminDomain).names : []),
    ...(ctx.apiDomain ? [ctx.apiDomain] : []),
  ];
}

export async function teardown(ctx: DeployContext, keepData: boolean): Promise<void> {
  const names = adminNames(ctx.appPrefix, ctx.accountId);
  const api = apiNames(ctx.appPrefix);

  await deleteDistribution(ctx, names.distributionComment);
  if (ctx.adminDomain && adminSiteNames(ctx.adminDomain).redirectNames.length > 0) {
    await deleteRedirectFunction(ctx, names.redirectFunction);
  }
  await deleteLambda(ctx, names.revalidationFunction);
  await deleteLambda(ctx, names.imageFunction);
  await deleteLambda(ctx, names.serverFunction);
  await deleteLambda(ctx, api.function);
  await deleteApiCustomDomain(ctx);
  await deleteHttpApi(ctx, api.api);
  await deleteQueue(ctx, names.revalidationQueue);
  await deleteOac(ctx, names.s3Oac);
  await deleteOac(ctx, names.lambdaOac);

  if (keepData) {
    ctx.log(
      `keeping data: ${names.assetsBucket}, ${ctx.mediaBucket}, ${api.usersTable}, ${api.resetTokensTable}, ${names.tagCacheTable}`,
    );
  } else {
    await deleteTable(ctx, api.usersTable);
    await deleteTable(ctx, api.resetTokensTable);
    await deleteTable(ctx, names.tagCacheTable);
    await emptyAndDeleteBucket(ctx, names.assetsBucket);
    await emptyAndDeleteBucket(ctx, ctx.mediaBucket);
  }

  await deleteRole(ctx, api.role, `${ctx.appPrefix}-api`);
  await deleteRole(ctx, names.role, names.distributionComment);
  await deleteRoute53DomainRecords(ctx);
  await deleteAcmCertificates(ctx);
}

export async function undeploy(options: UndeployOptions): Promise<void> {
  const repoRoot = findRepoRoot(process.cwd());
  const log = createLogger();
  const prompter = createPrompter();

  try {
    const region = await resolveRegion({
      repoRoot,
      region: options.region,
      ask: prompter.ask,
      log,
      persist: !options.dryRun,
    });
    const clients = createAwsClients(region);
    const appPrefix = await resolveAppPrefix({
      repoRoot,
      prefix: options.prefix,
      ask: prompter.ask,
      log,
      persist: !options.dryRun,
    });

    let keepData = options.keepData;
    if (keepData === undefined) {
      keepData = options.yes
        ? true
        : await confirm(prompter.ask, "Keep data (S3 objects and DynamoDB tables)?", true);
    }

    if (!options.yes) {
      const proceed = await confirm(
        prompter.ask,
        `Delete resources for app "${appPrefix}" in ${region}${
          keepData ? " (keeping data)" : " (including data)"
        }?`,
        false,
      );
      if (!proceed) {
        log("undeploy aborted");
        return;
      }
    }

    const identity = await clients.sts.send(new GetCallerIdentityCommand({}));
    if (!identity.Account) {
      throw new Error("Could not determine the AWS account ID. Check your credentials.");
    }

    const config = loadConfig(repoRoot);
    const mediaBucket = config?.mediaBucket ?? `${appPrefix}-media`;

    const ctx: DeployContext = {
      region,
      accountId: identity.Account,
      dryRun: options.dryRun,
      repoRoot,
      appPrefix,
      mediaBucket,
      adminDomain: config?.adminDomain,
      apiDomain: config?.apiDomain,
      hostedZone: config?.hostedZone,
      adminCertificateArn: config?.adminCertificateArn,
      apiCertificateArn: config?.apiCertificateArn,
      log,
      clients,
    };

    log(
      options.dryRun
        ? `dry run: ${appPrefix} resources that would be deleted in ${region}`
        : `undeploying app "${appPrefix}" from account ${identity.Account} in ${region}`,
    );

    await teardown(ctx, keepData);
  } finally {
    prompter.close();
  }
}
