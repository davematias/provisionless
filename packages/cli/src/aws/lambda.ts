import {
  AddPermissionCommand,
  CreateFunctionCommand,
  GetFunctionCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
} from "@aws-sdk/client-lambda";
import {
  AttachRolePolicyCommand,
  CreateRoleCommand,
  GetRoleCommand,
  PutRolePolicyCommand,
} from "@aws-sdk/client-iam";

import type { DeployContext } from "../deploy/context.ts";
import { isAwsError, sleep } from "../util/aws.ts";

export const LAMBDA_RUNTIME = "nodejs22.x";
const BASIC_EXECUTION_POLICY = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole";

const ASSUME_ROLE_POLICY = JSON.stringify({
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Principal: { Service: "lambda.amazonaws.com" },
      Action: "sts:AssumeRole",
    },
  ],
});

export async function ensureLambdaRole(ctx: DeployContext, roleName: string): Promise<string> {
  try {
    const existing = await ctx.clients.iam.send(new GetRoleCommand({ RoleName: roleName }));
    if (existing.Role?.Arn) {
      return existing.Role.Arn;
    }
  } catch (error) {
    if (!isAwsError(error, "NoSuchEntityException")) {
      throw error;
    }
  }

  if (ctx.dryRun) {
    ctx.log(`would create IAM role ${roleName}`);
    return `arn:aws:iam::${ctx.accountId}:role/${roleName}`;
  }

  ctx.log(`creating IAM role ${roleName}`);
  const created = await ctx.clients.iam.send(
    new CreateRoleCommand({ RoleName: roleName, AssumeRolePolicyDocument: ASSUME_ROLE_POLICY }),
  );
  await ctx.clients.iam.send(
    new AttachRolePolicyCommand({ RoleName: roleName, PolicyArn: BASIC_EXECUTION_POLICY }),
  );
  return created.Role?.Arn ?? `arn:aws:iam::${ctx.accountId}:role/${roleName}`;
}

export async function putRolePolicy(
  ctx: DeployContext,
  roleName: string,
  policyName: string,
  statements: unknown[],
): Promise<void> {
  if (ctx.dryRun) {
    ctx.log(`would set inline policy ${policyName} on ${roleName}`);
    return;
  }
  await ctx.clients.iam.send(
    new PutRolePolicyCommand({
      RoleName: roleName,
      PolicyName: policyName,
      PolicyDocument: JSON.stringify({ Version: "2012-10-17", Statement: statements }),
    }),
  );
}

async function waitForFunction(ctx: DeployContext, name: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = await ctx.clients.lambda.send(new GetFunctionCommand({ FunctionName: name }));
    const configuration = result.Configuration;
    if (configuration?.LastUpdateStatus === "Failed") {
      throw new Error(
        `Lambda ${name} failed to update: ${configuration.StateReason ?? "unknown reason"}`,
      );
    }
    const active = configuration?.State === "Active";
    const settled = configuration?.LastUpdateStatus !== "InProgress";
    if (active && settled) {
      return;
    }
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for Lambda ${name}`);
}

export interface FunctionSpec {
  name: string;
  roleArn: string;
  zip: Buffer;
  handler: string;
  description: string;
  env?: Record<string, string>;
  timeout?: number;
  memorySize?: number;
}

export async function deployFunction(ctx: DeployContext, spec: FunctionSpec): Promise<string> {
  const arn = `arn:aws:lambda:${ctx.region}:${ctx.accountId}:function:${spec.name}`;
  const environment = spec.env ? { Variables: spec.env } : undefined;

  let exists = true;
  try {
    await ctx.clients.lambda.send(new GetFunctionCommand({ FunctionName: spec.name }));
  } catch (error) {
    if (isAwsError(error, "ResourceNotFoundException")) {
      exists = false;
    } else {
      throw error;
    }
  }

  if (ctx.dryRun) {
    ctx.log(`would ${exists ? "update" : "create"} Lambda ${spec.name}`);
    return arn;
  }

  if (!exists) {
    ctx.log(`creating Lambda ${spec.name}`);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        await ctx.clients.lambda.send(
          new CreateFunctionCommand({
            FunctionName: spec.name,
            Runtime: LAMBDA_RUNTIME,
            Role: spec.roleArn,
            Handler: spec.handler,
            Code: { ZipFile: spec.zip },
            Architectures: ["arm64"],
            Timeout: spec.timeout ?? 30,
            MemorySize: spec.memorySize ?? 1024,
            Description: spec.description,
            Environment: environment,
          }),
        );
        break;
      } catch (error) {
        if (isAwsError(error, "InvalidParameterValueException") && attempt < 11) {
          await sleep(5000);
          continue;
        }
        throw error;
      }
    }
  } else {
    ctx.log(`updating Lambda ${spec.name}`);
    await ctx.clients.lambda.send(
      new UpdateFunctionConfigurationCommand({
        FunctionName: spec.name,
        Role: spec.roleArn,
        Handler: spec.handler,
        Timeout: spec.timeout ?? 30,
        MemorySize: spec.memorySize ?? 1024,
        Description: spec.description,
        Environment: environment,
      }),
    );
    await waitForFunction(ctx, spec.name);
    await ctx.clients.lambda.send(
      new UpdateFunctionCodeCommand({ FunctionName: spec.name, ZipFile: spec.zip, Publish: true }),
    );
  }

  await waitForFunction(ctx, spec.name);
  return arn;
}

export async function updateFunctionEnvironment(
  ctx: DeployContext,
  name: string,
  env: Record<string, string>,
): Promise<void> {
  if (ctx.dryRun) {
    return;
  }
  await ctx.clients.lambda.send(
    new UpdateFunctionConfigurationCommand({
      FunctionName: name,
      Environment: { Variables: env },
    }),
  );
  await waitForFunction(ctx, name);
}

export async function addInvokePermission(
  ctx: DeployContext,
  functionName: string,
  statementId: string,
  principal: string,
  sourceArn: string,
  options: { functionUrl?: boolean } = {},
): Promise<void> {
  if (ctx.dryRun) {
    return;
  }
  try {
    await ctx.clients.lambda.send(
      new AddPermissionCommand({
        FunctionName: functionName,
        StatementId: statementId,
        Action: options.functionUrl ? "lambda:InvokeFunctionUrl" : "lambda:InvokeFunction",
        Principal: principal,
        SourceArn: sourceArn,
        FunctionUrlAuthType: options.functionUrl ? "AWS_IAM" : undefined,
      }),
    );
  } catch (error) {
    if (!isAwsError(error, "ResourceConflictException")) {
      throw error;
    }
  }
}
