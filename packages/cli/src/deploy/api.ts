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
import { isAwsError, sleep } from "../util/aws.ts";
import { zipFile } from "../util/zip.ts";
import type { DeployContext } from "./context.ts";

const FUNCTION_NAME = "provisionless-api";
const ROLE_NAME = "provisionless-api-role";
const API_NAME = "provisionless-api";
const USERS_TABLE_NAME = "provisionless-users";

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
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
  });
  return zipFile("index.mjs", new Uint8Array(readFileSync(outfile)));
}

async function findApiId(ctx: DeployContext): Promise<string | undefined> {
  const result = await ctx.clients.apiGateway.send(new GetApisCommand({}));
  return result.Items?.find((api) => api.Name === API_NAME)?.ApiId;
}

export async function ensureHttpApi(ctx: DeployContext, functionArn: string): Promise<string> {
  let apiId = await findApiId(ctx);

  if (!apiId) {
    if (ctx.dryRun) {
      ctx.log(`would create API Gateway HTTP API ${API_NAME}`);
      return `https://<api-id>.execute-api.${ctx.region}.amazonaws.com`;
    }
    ctx.log(`creating API Gateway HTTP API ${API_NAME}`);
    const created = await ctx.clients.apiGateway.send(
      new CreateApiCommand({ Name: API_NAME, ProtocolType: "HTTP" }),
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
    FUNCTION_NAME,
    `apigateway-${apiId}`,
    "apigateway.amazonaws.com",
    `arn:aws:execute-api:${ctx.region}:${ctx.accountId}:${apiId}/*`,
  );

  return `https://${apiId}.execute-api.${ctx.region}.amazonaws.com`;
}

export async function ensureUsersTable(ctx: DeployContext): Promise<string> {
  try {
    const existing = await ctx.clients.dynamodb.send(
      new DescribeTableCommand({ TableName: USERS_TABLE_NAME }),
    );
    if (existing.Table?.TableStatus === "ACTIVE") {
      return USERS_TABLE_NAME;
    }
  } catch (error) {
    if (!isAwsError(error, "ResourceNotFoundException")) {
      throw error;
    }
  }

  if (ctx.dryRun) {
    ctx.log(`would create DynamoDB table ${USERS_TABLE_NAME}`);
    return USERS_TABLE_NAME;
  }

  ctx.log(`creating DynamoDB table ${USERS_TABLE_NAME}`);
  await ctx.clients.dynamodb.send(
    new CreateTableCommand({
      TableName: USERS_TABLE_NAME,
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
      new DescribeTableCommand({ TableName: USERS_TABLE_NAME }),
    );
    if (result.Table?.TableStatus === "ACTIVE") {
      return USERS_TABLE_NAME;
    }
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for DynamoDB table ${USERS_TABLE_NAME}`);
}

export async function deployApi(ctx: DeployContext): Promise<string> {
  ctx.log("bundling API Lambda");
  const zip = ctx.dryRun ? Buffer.alloc(0) : await bundleApi(ctx.repoRoot);
  const tableName = await ensureUsersTable(ctx);
  const roleArn = await ensureLambdaRole(ctx, ROLE_NAME);

  await putRolePolicy(ctx, ROLE_NAME, "provisionless-api", [
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
  ]);

  const functionArn = await deployFunction(ctx, {
    name: FUNCTION_NAME,
    roleArn,
    zip,
    handler: "index.handler",
    description: "Provisionless API",
    timeout: 30,
    memorySize: 1024,
    env: { USERS_TABLE_NAME: tableName },
  });
  const url = await ensureHttpApi(ctx, functionArn);
  ctx.log(`API deployed: ${url}`);
  return url;
}
