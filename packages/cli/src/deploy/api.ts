import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CreateApiCommand,
  CreateIntegrationCommand,
  CreateRouteCommand,
  CreateStageCommand,
  GetApisCommand,
  GetIntegrationsCommand,
  GetRoutesCommand,
  GetStagesCommand,
} from "@aws-sdk/client-apigatewayv2";
import { CreateTableCommand, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import { build } from "esbuild";

import {
  addInvokePermission,
  deployFunction,
  ensureLambdaRole,
  putRolePolicy,
} from "../aws/lambda.ts";
import { apiNames } from "../aws/names.ts";
import { isAwsError, sleep } from "../util/aws.ts";
import { zipFile } from "../util/zip.ts";
import type { DeployContext } from "./context.ts";

async function bundleApi(repoRoot: string): Promise<Buffer> {
  const outfile = join(mkdtempSync(join(tmpdir(), "provisionless-api-")), "index.mjs");
  await build({
    entryPoints: [join(repoRoot, "packages", "api", "src", "lambda.ts")],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    outfile,
    logLevel: "silent",
    alias: {
      "@provisionless/core": join(repoRoot, "packages", "core", "src", "index.ts"),
    },
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
  });
  return zipFile("index.mjs", new Uint8Array(readFileSync(outfile)));
}

async function findApiId(ctx: DeployContext): Promise<string | undefined> {
  const { api } = apiNames(ctx.appPrefix);
  const result = await ctx.clients.apiGateway.send(new GetApisCommand({}));
  return result.Items?.find((item) => item.Name === api)?.ApiId;
}

export async function ensureHttpApi(ctx: DeployContext, functionArn: string): Promise<string> {
  const names = apiNames(ctx.appPrefix);
  let apiId = await findApiId(ctx);

  if (!apiId) {
    if (ctx.dryRun) {
      ctx.log(`would create API Gateway HTTP API ${names.api}`);
      return `https://<api-id>.execute-api.${ctx.region}.amazonaws.com`;
    }
    ctx.log(`creating API Gateway HTTP API ${names.api}`);
    const created = await ctx.clients.apiGateway.send(
      new CreateApiCommand({ Name: names.api, ProtocolType: "HTTP" }),
    );
    apiId = created.ApiId;
  }
  if (!apiId) {
    throw new Error("API Gateway did not return an API ID");
  }

  const integrations = await ctx.clients.apiGateway.send(
    new GetIntegrationsCommand({ ApiId: apiId }),
  );
  let integrationId = integrations.Items?.find(
    (integration) => integration.IntegrationUri === functionArn,
  )?.IntegrationId;

  if (!integrationId) {
    const created = await ctx.clients.apiGateway.send(
      new CreateIntegrationCommand({
        ApiId: apiId,
        IntegrationType: "AWS_PROXY",
        IntegrationUri: functionArn,
        PayloadFormatVersion: "2.0",
        TimeoutInMillis: 30000,
      }),
    );
    integrationId = created.IntegrationId;
  }
  if (!integrationId) {
    throw new Error("API Gateway did not return an integration ID");
  }

  const routes = await ctx.clients.apiGateway.send(new GetRoutesCommand({ ApiId: apiId }));
  if (!routes.Items?.some((route) => route.RouteKey === "$default")) {
    await ctx.clients.apiGateway.send(
      new CreateRouteCommand({
        ApiId: apiId,
        RouteKey: "$default",
        Target: `integrations/${integrationId}`,
      }),
    );
  }

  const stages = await ctx.clients.apiGateway.send(new GetStagesCommand({ ApiId: apiId }));
  if (!stages.Items?.some((stage) => stage.StageName === "$default")) {
    await ctx.clients.apiGateway.send(
      new CreateStageCommand({ ApiId: apiId, StageName: "$default", AutoDeploy: true }),
    );
  }

  await addInvokePermission(
    ctx,
    names.function,
    `apigateway-${apiId}`,
    "apigateway.amazonaws.com",
    `arn:aws:execute-api:${ctx.region}:${ctx.accountId}:${apiId}/*`,
  );

  return `https://${apiId}.execute-api.${ctx.region}.amazonaws.com`;
}

export async function ensureUsersTable(ctx: DeployContext): Promise<string> {
  const { usersTable } = apiNames(ctx.appPrefix);

  try {
    const existing = await ctx.clients.dynamodb.send(
      new DescribeTableCommand({ TableName: usersTable }),
    );
    if (existing.Table?.TableStatus === "ACTIVE") {
      return usersTable;
    }
  } catch (error) {
    if (!isAwsError(error, "ResourceNotFoundException")) {
      throw error;
    }
  }

  if (ctx.dryRun) {
    ctx.log(`would create DynamoDB table ${usersTable}`);
    return usersTable;
  }

  ctx.log(`creating DynamoDB table ${usersTable}`);
  await ctx.clients.dynamodb.send(
    new CreateTableCommand({
      TableName: usersTable,
      AttributeDefinitions: [
        { AttributeName: "username", AttributeType: "S" },
        { AttributeName: "id", AttributeType: "S" },
      ],
      KeySchema: [{ AttributeName: "username", KeyType: "HASH" }],
      GlobalSecondaryIndexes: [
        {
          IndexName: "id-index",
          KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
          Projection: { ProjectionType: "ALL" },
        },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await ctx.clients.dynamodb.send(
      new DescribeTableCommand({ TableName: usersTable }),
    );
    if (result.Table?.TableStatus === "ACTIVE") {
      return usersTable;
    }
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for DynamoDB table ${usersTable}`);
}

export async function deployApi(ctx: DeployContext, jwtSecret: string): Promise<string> {
  const names = apiNames(ctx.appPrefix);
  ctx.log("bundling API Lambda");
  const zip = ctx.dryRun ? Buffer.alloc(0) : await bundleApi(ctx.repoRoot);
  const tableName = await ensureUsersTable(ctx);
  const roleArn = await ensureLambdaRole(ctx, names.role);

  await putRolePolicy(ctx, names.role, `${ctx.appPrefix}-api`, [
    {
      Effect: "Allow",
      Action: [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan",
      ],
      Resource: [
        `arn:aws:dynamodb:${ctx.region}:${ctx.accountId}:table/${tableName}`,
        `arn:aws:dynamodb:${ctx.region}:${ctx.accountId}:table/${tableName}/index/*`,
      ],
    },
    {
      Effect: "Allow",
      Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      Resource: `arn:aws:s3:::${ctx.mediaBucket}/*`,
    },
    {
      Effect: "Allow",
      Action: ["s3:ListBucket"],
      Resource: `arn:aws:s3:::${ctx.mediaBucket}`,
    },
  ]);

  const functionArn = await deployFunction(ctx, {
    name: names.function,
    roleArn,
    zip,
    handler: "index.handler",
    description: `Provisionless API (${ctx.appPrefix})`,
    timeout: 30,
    memorySize: 1024,
    env: {
      USERS_TABLE_NAME: tableName,
      MEDIA_BUCKET_NAME: ctx.mediaBucket,
      JWT_SECRET: jwtSecret,
    },
  });
  const url = await ensureHttpApi(ctx, functionArn);
  ctx.log(`API deployed: ${url}`);
  return url;
}
