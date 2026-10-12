import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import type {
  CacheBehavior,
  DefaultCacheBehavior,
  DistributionConfig,
  FunctionAssociation,
  Method,
  Origin,
  OriginAccessControlSummary,
} from "@aws-sdk/client-cloudfront";
import {
  CreateDistributionCommand,
  CreateFunctionCommand,
  CreateOriginAccessControlCommand,
  DescribeFunctionCommand,
  GetDistributionCommand,
  GetFunctionCommand,
  ListDistributionsCommand,
  ListOriginAccessControlsCommand,
  PublishFunctionCommand,
  UpdateDistributionCommand,
  UpdateFunctionCommand,
} from "@aws-sdk/client-cloudfront";
import { CreateTableCommand, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import {
  CreateEventSourceMappingCommand,
  CreateFunctionUrlConfigCommand,
  GetFunctionUrlConfigCommand,
} from "@aws-sdk/client-lambda";
import { PutBucketPolicyCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
} from "@aws-sdk/client-sqs";

import {
  addInvokePermission,
  deployFunction,
  ensureLambdaRole,
  putRolePolicy,
  updateFunctionEnvironment,
} from "../aws/lambda.ts";
import { adminSiteNames } from "../aws/domains.ts";
import { adminNames } from "../aws/names.ts";
import {
  CLOUDFRONT_HOSTED_ZONE_ID,
  resolveHostedZoneId,
  upsertAliasRecords,
} from "../aws/route53.ts";
import { ensureBucket } from "../aws/s3.ts";
import { isAwsError, sleep } from "../util/aws.ts";
import { zipDirectory } from "../util/zip.ts";
import type { DeployContext } from "./context.ts";

const CACHING_DISABLED_POLICY = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad";
const CACHING_OPTIMIZED_POLICY = "658327ea-f89d-4fab-a63d-7e88639e58f6";
const ALL_VIEWER_EXCEPT_HOST_POLICY = "b689b0a8-53d0-40ab-baf2-68738e2966ac";
const ALL_VIEWER_POLICY = "216adef6-5c7f-47e4-b989-5492eafa07d3";

export type OriginName = "s3" | "default" | "imageOptimizer";

export interface OpenNextOutput {
  origins: {
    s3: { copy: Array<{ from: string; to: string }> };
    default: { bundle: string; handler: string };
    imageOptimizer: { bundle: string; handler: string };
  };
  additionalProps: {
    revalidationFunction: { bundle: string; handler: string };
  };
  behaviors: Array<{ pattern: string; origin: OriginName }>;
}
export interface AdminDeployment {
  url: string;
}

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html",
  ".ico": "image/x-icon",
  ".js": "text/javascript",
  ".json": "application/json",
  ".map": "application/json",
  ".mjs": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf(".");
  return (
    (dot >= 0 ? CONTENT_TYPES[path.slice(dot).toLowerCase()] : undefined) ??
    "application/octet-stream"
  );
}

function bundleDir(openNextDir: string, bundle: string): string {
  return join(openNextDir, bundle.replace(".open-next/", ""));
}

async function ensureTagCacheTable(ctx: DeployContext, tableName: string): Promise<void> {
  try {
    const existing = await ctx.clients.dynamodb.send(
      new DescribeTableCommand({ TableName: tableName }),
    );
    if (existing.Table?.TableStatus === "ACTIVE") {
      return;
    }
  } catch (error) {
    if (!isAwsError(error, "ResourceNotFoundException")) {
      throw error;
    }
  }

  if (ctx.dryRun) {
    ctx.log(`would create DynamoDB table ${tableName}`);
    return;
  }

  ctx.log(`creating DynamoDB table ${tableName}`);
  await ctx.clients.dynamodb.send(
    new CreateTableCommand({
      TableName: tableName,
      AttributeDefinitions: [
        { AttributeName: "tag", AttributeType: "S" },
        { AttributeName: "path", AttributeType: "S" },
        { AttributeName: "revalidatedAt", AttributeType: "N" },
      ],
      KeySchema: [
        { AttributeName: "tag", KeyType: "HASH" },
        { AttributeName: "path", KeyType: "RANGE" },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "revalidate",
          KeySchema: [
            { AttributeName: "path", KeyType: "HASH" },
            { AttributeName: "revalidatedAt", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
        },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await ctx.clients.dynamodb.send(
      new DescribeTableCommand({ TableName: tableName }),
    );
    if (result.Table?.TableStatus === "ACTIVE") {
      return;
    }
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for DynamoDB table ${tableName}`);
}

async function ensureRevalidationQueue(ctx: DeployContext, queueName: string): Promise<string> {
  try {
    const existing = await ctx.clients.sqs.send(new GetQueueUrlCommand({ QueueName: queueName }));
    if (existing.QueueUrl) {
      return existing.QueueUrl;
    }
  } catch (error) {
    const missing =
      isAwsError(error, "QueueDoesNotExist") ||
      isAwsError(error, "AWS.SimpleQueueService.NonExistentQueue");
    if (!missing) {
      throw error;
    }
  }

  if (ctx.dryRun) {
    ctx.log(`would create SQS FIFO queue ${queueName}`);
    return `https://sqs.${ctx.region}.amazonaws.com/${ctx.accountId}/${queueName}`;
  }

  ctx.log(`creating SQS FIFO queue ${queueName}`);
  const created = await ctx.clients.sqs.send(
    new CreateQueueCommand({
      QueueName: queueName,
      Attributes: { FifoQueue: "true", ContentBasedDeduplication: "true" },
    }),
  );
  if (!created.QueueUrl) {
    throw new Error("SQS did not return a queue URL");
  }
  return created.QueueUrl;
}

async function ensureFunctionUrl(ctx: DeployContext, functionName: string): Promise<string> {
  try {
    const existing = await ctx.clients.lambda.send(
      new GetFunctionUrlConfigCommand({ FunctionName: functionName }),
    );
    if (existing.FunctionUrl) {
      return existing.FunctionUrl;
    }
  } catch (error) {
    if (!isAwsError(error, "ResourceNotFoundException")) {
      throw error;
    }
  }

  if (ctx.dryRun) {
    ctx.log(`would create Function URL for ${functionName}`);
    return `https://dry-run.lambda-url.${ctx.region}.on.aws`;
  }

  ctx.log(`creating Function URL for ${functionName}`);
  const created = await ctx.clients.lambda.send(
    new CreateFunctionUrlConfigCommand({ FunctionName: functionName, AuthType: "AWS_IAM" }),
  );
  if (!created.FunctionUrl) {
    throw new Error(`No Function URL returned for ${functionName}`);
  }
  return created.FunctionUrl;
}

async function ensureOriginAccessControl(
  ctx: DeployContext,
  name: string,
  originType: "s3" | "lambda",
): Promise<string> {
  const listed = await ctx.clients.cloudfront.send(new ListOriginAccessControlsCommand({}));
  const existing = (listed.OriginAccessControlList?.Items ?? []).find(
    (item: OriginAccessControlSummary) => item.Name === name,
  );
  if (existing?.Id) {
    return existing.Id;
  }

  if (ctx.dryRun) {
    ctx.log(`would create CloudFront origin access control ${name}`);
    return name;
  }

  ctx.log(`creating CloudFront origin access control ${name}`);
  const created = await ctx.clients.cloudfront.send(
    new CreateOriginAccessControlCommand({
      OriginAccessControlConfig: {
        Name: name,
        OriginAccessControlOriginType: originType,
        SigningBehavior: "always",
        SigningProtocol: "sigv4",
      },
    }),
  );
  if (!created.OriginAccessControl?.Id) {
    throw new Error(`No origin access control ID returned for ${name}`);
  }
  return created.OriginAccessControl.Id;
}

async function findDistribution(
  ctx: DeployContext,
  comment: string,
): Promise<
  | {
      id: string;
      domainName: string;
      eTag?: string;
      callerReference?: string;
      config: DistributionConfig;
    }
  | undefined
> {
  const listed = await ctx.clients.cloudfront.send(new ListDistributionsCommand({}));
  const found = listed.DistributionList?.Items?.find((item) => item.Comment === comment);
  if (!found?.Id) {
    return undefined;
  }
  const detail = await ctx.clients.cloudfront.send(new GetDistributionCommand({ Id: found.Id }));
  const distribution = detail.Distribution;
  if (!distribution?.Id || !distribution.DomainName || !distribution.DistributionConfig) {
    return undefined;
  }
  return {
    id: distribution.Id,
    domainName: distribution.DomainName,
    eTag: detail.ETag,
    callerReference: distribution.DistributionConfig.CallerReference,
    config: distribution.DistributionConfig,
  };
}

function buildOrigins(
  s3Domain: string,
  s3OacId: string,
  serverDomain: string,
  imageDomain: string,
  lambdaOacId: string,
): Origin[] {
  const lambdaOrigin = (domain: string): Omit<Origin, "Id"> => ({
    DomainName: domain,
    CustomHeaders: { Quantity: 0, Items: [] },
    OriginAccessControlId: lambdaOacId,
    ConnectionAttempts: 3,
    ConnectionTimeout: 10,
    CustomOriginConfig: {
      HTTPPort: 80,
      HTTPSPort: 443,
      OriginProtocolPolicy: "https-only",
      OriginSslProtocols: { Quantity: 1, Items: ["TLSv1.2"] },
      OriginReadTimeout: 30,
      OriginKeepaliveTimeout: 5,
    },
  });

  return [
    {
      Id: "s3",
      DomainName: s3Domain,
      OriginPath: "/_assets",
      CustomHeaders: { Quantity: 0, Items: [] },
      OriginAccessControlId: s3OacId,
      ConnectionAttempts: 3,
      ConnectionTimeout: 10,
      S3OriginConfig: { OriginAccessIdentity: "" },
    },
    { ...lambdaOrigin(serverDomain), Id: "default" },
    { ...lambdaOrigin(imageDomain), Id: "imageOptimizer" },
  ];
}

export interface AdminDomainConfig {
  canonical: string;
  aliases: string[];
  certificateArn: string;
  redirectFunctionArn?: string;
}

const REDIRECT_ASSOCIATIONS = (
  functionArn: string,
): { Quantity: number; Items: FunctionAssociation[] } => ({
  Quantity: 1,
  Items: [{ EventType: "viewer-request", FunctionARN: functionArn }],
});

export function redirectFunctionCode(canonical: string): string {
  return `function handler(event) {
  var request = event.request;
  var host = request.headers.host.value;
  var canonical = "${canonical}";
  if (host === canonical) {
    return request;
  }
  var location = "https://" + canonical + request.uri;
  var querystring = "";
  for (var key in request.querystring) {
    if (querystring === "") {
      querystring = "?";
    } else {
      querystring = querystring + "&";
    }
    querystring = querystring + key + "=" + request.querystring[key].value;
  }
  return {
    statusCode: 301,
    statusDescription: "Moved Permanently",
    headers: { location: { value: location + querystring } },
  };
}`;
}

interface FunctionStageInfo {
  eTag: string;
  status?: string;
}

async function describeFunctionStage(
  ctx: DeployContext,
  name: string,
  stage: "DEVELOPMENT" | "LIVE",
): Promise<FunctionStageInfo | undefined> {
  try {
    const result = await ctx.clients.cloudfront.send(
      new DescribeFunctionCommand({ Name: name, Stage: stage }),
    );
    return { eTag: result.ETag ?? "", status: result.FunctionSummary?.Status };
  } catch (error) {
    if (isAwsError(error, "NoSuchFunctionExists")) {
      return undefined;
    }
    throw error;
  }
}

async function getFunctionCode(
  ctx: DeployContext,
  name: string,
  stage: "DEVELOPMENT" | "LIVE",
): Promise<string | undefined> {
  const result = await ctx.clients.cloudfront.send(
    new GetFunctionCommand({ Name: name, Stage: stage }),
  );
  return result.FunctionCode ? Buffer.from(result.FunctionCode).toString("utf8") : undefined;
}

async function waitForFunctionStage(
  ctx: DeployContext,
  name: string,
  stage: "DEVELOPMENT" | "LIVE",
  target: string,
  attempts = 30,
): Promise<FunctionStageInfo> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const info = await describeFunctionStage(ctx, name, stage);
    if (!info) {
      throw new Error(`CloudFront function ${name} disappeared`);
    }
    if (info.status === target) {
      return info;
    }
    if (info.status === "INVALID") {
      throw new Error(`CloudFront function ${name} is invalid`);
    }
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for CloudFront function ${name} to be ${target}`);
}

export async function ensureRedirectFunction(
  ctx: DeployContext,
  name: string,
  canonical: string,
): Promise<string> {
  const arn = `arn:aws:cloudfront::${ctx.accountId}:function/${name}`;
  const code = redirectFunctionCode(canonical);

  if (ctx.dryRun) {
    ctx.log(`would create CloudFront redirect function ${name} for ${canonical}`);
    return arn;
  }

  const config = {
    Comment: `${name}: redirect to ${canonical}`,
    Runtime: "cloudfront-js-2.0" as const,
  };

  const development = await describeFunctionStage(ctx, name, "DEVELOPMENT");
  let changed = false;
  if (!development) {
    ctx.log(`creating CloudFront redirect function ${name}`);
    await ctx.clients.cloudfront.send(
      new CreateFunctionCommand({
        Name: name,
        FunctionConfig: config,
        FunctionCode: Buffer.from(code, "utf8"),
      }),
    );
    changed = true;
  } else if ((await getFunctionCode(ctx, name, "DEVELOPMENT")) !== code) {
    ctx.log(`updating CloudFront redirect function ${name}`);
    await ctx.clients.cloudfront.send(
      new UpdateFunctionCommand({
        Name: name,
        IfMatch: development.eTag,
        FunctionConfig: config,
        FunctionCode: Buffer.from(code, "utf8"),
      }),
    );
    changed = true;
  }

  const live = await describeFunctionStage(ctx, name, "LIVE");
  if (changed || !live) {
    const unpublished = await waitForFunctionStage(ctx, name, "DEVELOPMENT", "UNPUBISHED");
    ctx.log(`publishing CloudFront redirect function ${name}`);
    await ctx.clients.cloudfront.send(
      new PublishFunctionCommand({ Name: name, IfMatch: unpublished.eTag }),
    );
    await waitForFunctionStage(ctx, name, "LIVE", "DEPLOYED");
  }

  return arn;
}

export async function configureAdminDns(
  ctx: DeployContext,
  names: string[],
  distributionDomain: string,
): Promise<void> {
  if (ctx.hostedZone) {
    if (ctx.dryRun) {
      ctx.log(`would upsert Route 53 alias records for ${names.join(", ")}`);
      return;
    }
    const hostedZoneId = await resolveHostedZoneId(ctx.clients.route53, ctx.hostedZone);
    ctx.log(`updating Route 53 alias records for ${names.join(", ")}`);
    await upsertAliasRecords(ctx.clients.route53, hostedZoneId, names, {
      dnsName: distributionDomain,
      hostedZoneId: CLOUDFRONT_HOSTED_ZONE_ID,
    });
    return;
  }
  ctx.log(
    `add A/AAAA alias records in your DNS provider pointing ${names.join(", ")} to ${distributionDomain}`,
  );
}

export function buildDistributionConfig(
  output: OpenNextOutput,
  origins: Origin[],
  callerReference: string,
  comment: string,
  domain?: AdminDomainConfig,
): DistributionConfig {
  const cachePolicyFor = (origin: OriginName): string =>
    origin === "s3" || origin === "imageOptimizer"
      ? CACHING_OPTIMIZED_POLICY
      : CACHING_DISABLED_POLICY;

  const allowedItems: Method[] = ["GET", "HEAD", "OPTIONS"];
  const cachedItems: Method[] = ["GET", "HEAD"];
  const allowedMethods = { Quantity: allowedItems.length, Items: allowedItems };
  const cachedMethods = { Quantity: cachedItems.length, Items: cachedItems };

  const functionAssociations = domain?.redirectFunctionArn
    ? REDIRECT_ASSOCIATIONS(domain.redirectFunctionArn)
    : { Quantity: 0, Items: [] };

  const defaultBehavior: DefaultCacheBehavior = {
    TargetOriginId: "default",
    ViewerProtocolPolicy: "redirect-to-https",
    AllowedMethods: { ...allowedMethods, CachedMethods: cachedMethods },
    CachePolicyId: CACHING_DISABLED_POLICY,
    OriginRequestPolicyId: ALL_VIEWER_EXCEPT_HOST_POLICY,
    FunctionAssociations: functionAssociations,
  };

  const orderedCacheBehaviors: CacheBehavior[] = output.behaviors
    .filter((behavior) => behavior.pattern !== "*")
    .map((behavior) => ({
      PathPattern: behavior.pattern,
      TargetOriginId: behavior.origin,
      ViewerProtocolPolicy: "redirect-to-https",
      AllowedMethods: { ...allowedMethods, CachedMethods: cachedMethods },
      CachePolicyId: cachePolicyFor(behavior.origin),
      OriginRequestPolicyId:
        behavior.origin === "imageOptimizer" ? ALL_VIEWER_POLICY : ALL_VIEWER_EXCEPT_HOST_POLICY,
      FunctionAssociations: functionAssociations,
    }));

  return {
    CallerReference: callerReference,
    Comment: comment,
    Aliases: domain ? { Quantity: domain.aliases.length, Items: domain.aliases } : { Quantity: 0 },
    Enabled: true,
    HttpVersion: "http2and3",
    PriceClass: "PriceClass_100",
    Origins: { Quantity: origins.length, Items: origins },
    DefaultCacheBehavior: defaultBehavior,
    CacheBehaviors: { Quantity: orderedCacheBehaviors.length, Items: orderedCacheBehaviors },
    ViewerCertificate: domain
      ? {
          ACMCertificateArn: domain.certificateArn,
          SSLSupportMethod: "sni-only",
          MinimumProtocolVersion: "TLSv1.2_2021",
        }
      : { CloudFrontDefaultCertificate: true },
  };
}

async function uploadDirectory(
  ctx: DeployContext,
  localDir: string,
  bucket: string,
  prefix: string,
): Promise<void> {
  if (!existsSync(localDir)) {
    return;
  }
  if (ctx.dryRun) {
    ctx.log(`would upload ${localDir} to s3://${bucket}/${prefix}`);
    return;
  }
  ctx.log(`uploading ${localDir} to s3://${bucket}/${prefix}`);

  const walk = async (dir: string): Promise<void> => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        await walk(full);
        continue;
      }
      const key = `${prefix}/${relative(localDir, full).split(sep).join("/")}`;
      const immutable = key.includes("/_next/static/");
      await ctx.clients.s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: readFileSync(full),
          ContentType: contentTypeFor(full),
          CacheControl: immutable ? "public, max-age=31536000, immutable" : undefined,
        }),
      );
    }
  };

  await walk(localDir);
}

export async function deployAdmin(ctx: DeployContext, apiUrl: string): Promise<AdminDeployment> {
  const openNextDir = join(ctx.repoRoot, "packages", "admin", ".open-next");
  const outputPath = join(openNextDir, "open-next.output.json");

  if (ctx.dryRun) {
    if (!existsSync(outputPath)) {
      throw new Error(
        "No OpenNext build found. Run `npm run build:lambda --workspace=@provisionless/admin` first.",
      );
    }
  } else {
    ctx.log("building admin Lambda bundle (open-next build)");
    execFileSync("npm", ["run", "build:lambda", "--workspace=@provisionless/admin"], {
      cwd: ctx.repoRoot,
      stdio: "inherit",
      env: { ...process.env, NEXT_PUBLIC_API_URL: apiUrl },
    });
  }

  const output = JSON.parse(readFileSync(outputPath, "utf8")) as OpenNextOutput;
  const names = adminNames(ctx.appPrefix, ctx.accountId);

  const {
    assetsBucket,
    tagCacheTable: tableName,
    revalidationQueue: queueName,
    role: roleName,
    serverFunction: serverName,
    imageFunction: imageName,
    revalidationFunction: revalidationName,
    distributionComment,
  } = names;

  await ensureBucket(ctx, assetsBucket);
  await ensureTagCacheTable(ctx, tableName);
  const queueUrl = await ensureRevalidationQueue(ctx, queueName);

  let queueArn = `arn:aws:sqs:${ctx.region}:${ctx.accountId}:${queueName}`;
  if (!ctx.dryRun) {
    const attributes = await ctx.clients.sqs.send(
      new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ["QueueArn"] }),
    );
    if (!attributes.Attributes?.QueueArn) {
      throw new Error("Could not resolve the revalidation queue ARN");
    }
    queueArn = attributes.Attributes.QueueArn;
  }

  const roleArn = await ensureLambdaRole(ctx, roleName);

  const commonEnv: Record<string, string> = {
    CACHE_BUCKET_NAME: assetsBucket,
    CACHE_BUCKET_REGION: ctx.region,
    CACHE_DYNAMO_TABLE: tableName,
    REVALIDATION_QUEUE_URL: queueUrl,
    REVALIDATION_QUEUE_REGION: ctx.region,
    BUCKET_NAME: assetsBucket,
    BUCKET_KEY_PREFIX: "_assets",
    BUCKET_REGION: ctx.region,
  };

  const emptyZip = Buffer.alloc(0);
  await deployFunction(ctx, {
    name: serverName,
    roleArn,
    zip: ctx.dryRun
      ? emptyZip
      : zipDirectory(bundleDir(openNextDir, output.origins.default.bundle)),
    handler: output.origins.default.handler,
    description: "Provisionless admin (SSR)",
    env: commonEnv,
    memorySize: 1024,
    timeout: 30,
  });
  await deployFunction(ctx, {
    name: imageName,
    roleArn,
    zip: ctx.dryRun
      ? emptyZip
      : zipDirectory(bundleDir(openNextDir, output.origins.imageOptimizer.bundle)),
    handler: output.origins.imageOptimizer.handler,
    description: "Provisionless admin (image optimization)",
    env: commonEnv,
    memorySize: 1536,
    timeout: 30,
  });
  await deployFunction(ctx, {
    name: revalidationName,
    roleArn,
    zip: ctx.dryRun
      ? emptyZip
      : zipDirectory(bundleDir(openNextDir, output.additionalProps.revalidationFunction.bundle)),
    handler: output.additionalProps.revalidationFunction.handler,
    description: "Provisionless admin (revalidation)",
    env: commonEnv,
    memorySize: 1024,
    timeout: 30,
  });

  const serverUrl = await ensureFunctionUrl(ctx, serverName);
  const imageUrl = await ensureFunctionUrl(ctx, imageName);

  const s3OacId = await ensureOriginAccessControl(ctx, names.s3Oac, "s3");
  const lambdaOacId = await ensureOriginAccessControl(ctx, names.lambdaOac, "lambda");

  const origins = buildOrigins(
    `${assetsBucket}.s3.${ctx.region}.amazonaws.com`,
    s3OacId,
    new URL(serverUrl).host,
    new URL(imageUrl).host,
    lambdaOacId,
  );

  const site = ctx.adminDomain ? adminSiteNames(ctx.adminDomain) : undefined;
  const attachDomain = Boolean(
    site && (ctx.dryRun || (ctx.adminCertificateArn && ctx.adminCertificateIssued)),
  );
  if (site && !ctx.dryRun && !attachDomain) {
    ctx.log(
      `admin domain ${site.canonical} not attached yet: the ACM certificate is still pending DNS validation; re-run deploy once it is issued`,
    );
  }
  let domainConfig: AdminDomainConfig | undefined;
  if (site && attachDomain) {
    domainConfig = {
      canonical: site.canonical,
      aliases: site.names,
      certificateArn: ctx.adminCertificateArn ?? "<ACM certificate ARN>",
      redirectFunctionArn:
        site.redirectNames.length > 0
          ? await ensureRedirectFunction(ctx, names.redirectFunction, site.canonical)
          : undefined,
    };
  }

  const existing = await findDistribution(ctx, distributionComment);
  let distributionId = existing?.id;
  let distributionDomain = existing?.domainName;

  if (existing) {
    if (!ctx.dryRun && existing.eTag) {
      ctx.log("updating CloudFront distribution");
      const desired = buildDistributionConfig(
        output,
        origins,
        existing.config.CallerReference ?? `${ctx.appPrefix}-admin-${Date.now()}`,
        distributionComment,
        domainConfig,
      );
      const mergedOrigins = (desired.Origins?.Items ?? []).map((origin) => ({
        ...existing.config.Origins?.Items?.find((prior) => prior.Id === origin.Id),
        ...origin,
      }));
      const mergedBehaviors = (desired.CacheBehaviors?.Items ?? []).map((behavior) => ({
        ...existing.config.CacheBehaviors?.Items?.find(
          (prior) => prior.PathPattern === behavior.PathPattern,
        ),
        ...behavior,
      }));
      const updated = await ctx.clients.cloudfront.send(
        new UpdateDistributionCommand({
          Id: existing.id,
          IfMatch: existing.eTag,
          DistributionConfig: {
            ...existing.config,
            Comment: distributionComment,
            Enabled: true,
            HttpVersion: "http2and3",
            PriceClass: "PriceClass_100",
            Aliases: desired.Aliases,
            ViewerCertificate: desired.ViewerCertificate,
            Origins: { Quantity: mergedOrigins.length, Items: mergedOrigins },
            DefaultCacheBehavior: {
              ...existing.config.DefaultCacheBehavior,
              ...desired.DefaultCacheBehavior,
            } as DefaultCacheBehavior,
            CacheBehaviors: {
              Quantity: mergedBehaviors.length,
              Items: mergedBehaviors,
            } as DistributionConfig["CacheBehaviors"],
          },
        }),
      );
      distributionDomain = updated.Distribution?.DomainName ?? distributionDomain;
    }
  } else if (ctx.dryRun) {
    ctx.log("would create CloudFront distribution");
    distributionDomain = "<dry-run>.cloudfront.net";
  } else {
    ctx.log("creating CloudFront distribution");
    const created = await ctx.clients.cloudfront.send(
      new CreateDistributionCommand({
        DistributionConfig: buildDistributionConfig(
          output,
          origins,
          `${ctx.appPrefix}-admin-${Date.now()}`,
          distributionComment,
          domainConfig,
        ),
      }),
    );
    distributionId = created.Distribution?.Id;
    distributionDomain = created.Distribution?.DomainName;
  }

  if (domainConfig && distributionDomain) {
    await configureAdminDns(ctx, domainConfig.aliases, distributionDomain);
  }

  if (distributionId) {
    await putRolePolicy(ctx, roleName, distributionComment, [
      {
        Effect: "Allow",
        Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        Resource: `arn:aws:s3:::${assetsBucket}/*`,
      },
      { Effect: "Allow", Action: ["s3:ListBucket"], Resource: `arn:aws:s3:::${assetsBucket}` },
      {
        Effect: "Allow",
        Action: [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:BatchWriteItem",
        ],
        Resource: [
          `arn:aws:dynamodb:${ctx.region}:${ctx.accountId}:table/${tableName}`,
          `arn:aws:dynamodb:${ctx.region}:${ctx.accountId}:table/${tableName}/index/*`,
        ],
      },
      {
        Effect: "Allow",
        Action: [
          "sqs:SendMessage",
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
        ],
        Resource: queueArn,
      },
      {
        Effect: "Allow",
        Action: ["cloudfront:CreateInvalidation"],
        Resource: `arn:aws:cloudfront::${ctx.accountId}:distribution/${distributionId}`,
      },
    ]);

    const distributionArn = `arn:aws:cloudfront::${ctx.accountId}:distribution/${distributionId}`;

    if (!ctx.dryRun) {
      await ctx.clients.s3.send(
        new PutBucketPolicyCommand({
          Bucket: assetsBucket,
          Policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
              {
                Sid: "AllowCloudFrontRead",
                Effect: "Allow",
                Principal: { Service: "cloudfront.amazonaws.com" },
                Action: "s3:GetObject",
                Resource: `arn:aws:s3:::${assetsBucket}/*`,
                Condition: { StringEquals: { "AWS:SourceArn": distributionArn } },
              },
            ],
          }),
        }),
      );
    }

    for (const [name, label] of [
      [serverName, "server"],
      [imageName, "image"],
    ] as const) {
      await addInvokePermission(
        ctx,
        name,
        `cloudfront-url-${label}-${distributionId}`,
        "cloudfront.amazonaws.com",
        distributionArn,
        { functionUrl: true },
      );
      await addInvokePermission(
        ctx,
        name,
        `cloudfront-fn-${label}-${distributionId}`,
        "cloudfront.amazonaws.com",
        distributionArn,
      );
    }

    await updateFunctionEnvironment(ctx, serverName, {
      ...commonEnv,
      CLOUDFRONT_DISTRIBUTION_ID: distributionId,
    });
  }

  await uploadDirectory(ctx, join(openNextDir, "assets"), assetsBucket, "_assets");
  await uploadDirectory(ctx, join(openNextDir, "cache"), assetsBucket, "_cache");

  if (!ctx.dryRun) {
    try {
      await ctx.clients.lambda.send(
        new CreateEventSourceMappingCommand({
          FunctionName: revalidationName,
          EventSourceArn: queueArn,
          BatchSize: 1,
          Enabled: true,
        }),
      );
    } catch (error) {
      if (!isAwsError(error, "ResourceConflictException")) {
        throw error;
      }
    }
  }

  const url =
    domainConfig && distributionDomain
      ? `https://${domainConfig.canonical}`
      : distributionDomain
        ? `https://${distributionDomain}`
        : "https://<pending>";
  ctx.log(`admin deployed: ${url}`);
  return { url };
}
