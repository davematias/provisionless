import { GetRoleCommand, SimulatePrincipalPolicyCommand } from "@aws-sdk/client-iam";
import { GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { expect, it } from "vitest";

import type { AwsClients } from "../aws/clients.ts";
import type { DeployContext } from "./context.ts";
import { requiredPermissionGroups, runPreflight } from "./preflight.ts";

const ACCOUNT = "111122223333";
const USER_ARN = `arn:aws:iam::${ACCOUNT}:user/deployer`;
const ROLE_ARN = `arn:aws:iam::${ACCOUNT}:role/deployer`;
const SESSION_ARN = `arn:aws:sts::${ACCOUNT}:assumed-role/deployer/session`;

function createContext(send: (command: unknown) => Promise<unknown>): DeployContext {
  return {
    region: "eu-west-1",
    accountId: ACCOUNT,
    dryRun: false,
    repoRoot: ".",
    appPrefix: "demo",
    mediaBucket: "demo-media",
    emailFrom: "no-reply@example.com",
    adminDomain: "example.com",
    apiDomain: "api.example.com",
    hostedZone: "example.com",
    log: () => undefined,
    clients: {
      sts: { send },
      iam: { send },
    } as unknown as AwsClients,
  };
}

function evaluations(
  command: SimulatePrincipalPolicyCommand,
  decision: (action: string, resource: string) => string = () => "allowed",
): { EvaluationResults: Array<Record<string, string>> } {
  const actions = command.input.ActionNames ?? [];
  const resources = command.input.ResourceArns ?? [];
  return {
    EvaluationResults: actions.flatMap((action) =>
      resources.map((resource) => ({
        EvalActionName: action,
        EvalResourceName: resource,
        EvalDecision: decision(action, resource),
      })),
    ),
  };
}

it("inventories every service the deploy path uses", async () => {
  const context = createContext(async () => ({}));
  const groups = requiredPermissionGroups(context);
  const actions = new Set(groups.flatMap((group) => group.actions));

  for (const action of [
    "sts:GetCallerIdentity",
    "iam:CreateRole",
    "iam:PassRole",
    "lambda:CreateFunction",
    "apigateway:POST",
    "s3:CreateBucket",
    "dynamodb:CreateTable",
    "dynamodb:PutItem",
    "sqs:CreateQueue",
    "sns:CreateTopic",
    "ses:CreateEmailIdentity",
    "cloudfront:CreateDistribution",
    "logs:PutResourcePolicy",
    "cloudwatch:PutMetricAlarm",
    "cloudwatch:PutDashboard",
    "acm:RequestCertificate",
    "route53:ChangeResourceRecordSets",
  ]) {
    expect(actions.has(action)).toBe(true);
  }
  for (const group of groups) {
    expect(group.actions.length).toBeGreaterThan(0);
    expect(group.resources.length).toBeGreaterThan(0);
  }
  expect([...actions].sort()).toMatchSnapshot();
});

it("passes when every simulated action is allowed", async () => {
  const commands: unknown[] = [];
  const context = createContext(async (command) => {
    commands.push(command);
    if (command instanceof GetCallerIdentityCommand) {
      return { Account: ACCOUNT, Arn: USER_ARN, UserId: "user" };
    }
    if (command instanceof SimulatePrincipalPolicyCommand) {
      return evaluations(command);
    }
    throw new Error(`unexpected command ${command?.constructor?.name}`);
  });

  const result = await runPreflight(context);

  expect(result.principalArn).toBe(USER_ARN);
  expect(result.actionCount).toBeGreaterThan(40);
  const simulations = commands.filter(
    (command): command is SimulatePrincipalPolicyCommand =>
      command instanceof SimulatePrincipalPolicyCommand,
  );
  expect(simulations.length).toBeGreaterThan(0);
  for (const simulation of simulations) {
    expect(simulation.input.PolicySourceArn).toBe(USER_ARN);
  }
});

it("groups denied actions by service with their resource", async () => {
  const context = createContext(async (command) => {
    if (command instanceof GetCallerIdentityCommand) {
      return { Account: ACCOUNT, Arn: USER_ARN, UserId: "user" };
    }
    if (command instanceof SimulatePrincipalPolicyCommand) {
      return evaluations(command, (action, resource) =>
        action === "lambda:CreateFunction" && resource.endsWith(":function:demo-admin-server")
          ? "implicitDeny"
          : "allowed",
      );
    }
    return {};
  });

  let failure: unknown;
  try {
    await runPreflight(context);
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(Error);
  const message = (failure as Error).message;
  expect(message).toMatch(/Preflight failed: 1 required permission\(s\) are denied/);
  expect(message).toContain("Lambda:");
  expect(message).toContain("lambda:CreateFunction");
  expect(message).toContain("function:demo-admin-server");
});

it("resolves an assumed-role session to its IAM role and simulates that role", async () => {
  const commands: unknown[] = [];
  const context = createContext(async (command) => {
    commands.push(command);
    if (command instanceof GetCallerIdentityCommand) {
      return { Account: ACCOUNT, Arn: SESSION_ARN, UserId: "session" };
    }
    if (command instanceof GetRoleCommand) {
      return { Role: { Arn: ROLE_ARN } };
    }
    if (command instanceof SimulatePrincipalPolicyCommand) {
      return evaluations(command);
    }
    throw new Error(`unexpected command ${command?.constructor?.name}`);
  });

  const result = await runPreflight(context);

  expect(result.principalArn).toBe(ROLE_ARN);
  const getRole = commands.find(
    (command): command is GetRoleCommand => command instanceof GetRoleCommand,
  );
  expect(getRole?.input.RoleName).toBe("deployer");
  const simulations = commands.filter(
    (command): command is SimulatePrincipalPolicyCommand =>
      command instanceof SimulatePrincipalPolicyCommand,
  );
  expect(simulations.every((command) => command.input.PolicySourceArn === ROLE_ARN)).toBe(true);
});

it("rejects the root user with a clear message and never simulates", async () => {
  const commands: unknown[] = [];
  const context = createContext(async (command) => {
    commands.push(command);
    if (command instanceof GetCallerIdentityCommand) {
      return { Account: ACCOUNT, Arn: `arn:aws:iam::${ACCOUNT}:root`, UserId: "root" };
    }
    return {};
  });

  await expect(runPreflight(context)).rejects.toThrow(/cannot simulate the AWS account root user/);
  expect(commands.some((command) => command instanceof SimulatePrincipalPolicyCommand)).toBe(false);
});

it("explains when the caller cannot run the simulation", async () => {
  const context = createContext(async (command) => {
    if (command instanceof GetCallerIdentityCommand) {
      return { Account: ACCOUNT, Arn: USER_ARN, UserId: "user" };
    }
    if (command instanceof SimulatePrincipalPolicyCommand) {
      const error = new Error("denied");
      error.name = "AccessDenied";
      throw error;
    }
    return {};
  });

  await expect(runPreflight(context)).rejects.toThrow(/iam:SimulatePrincipalPolicy/);
});

it("explains when iam:GetRole is unavailable for an assumed role", async () => {
  const context = createContext(async (command) => {
    if (command instanceof GetCallerIdentityCommand) {
      return { Account: ACCOUNT, Arn: SESSION_ARN, UserId: "session" };
    }
    if (command instanceof GetRoleCommand) {
      const error = new Error("denied");
      error.name = "AccessDenied";
      throw error;
    }
    return {};
  });

  await expect(runPreflight(context)).rejects.toThrow(/iam:GetRole/);
});
