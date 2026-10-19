import { CreateEmailIdentityCommand, GetEmailIdentityCommand } from "@aws-sdk/client-sesv2";
import { expect, it } from "vitest";

import type { AwsClients } from "../aws/clients.ts";
import type { DeployContext } from "./context.ts";
import { ensureEmailIdentity } from "./email.ts";

function createContext(
  send: (command: unknown) => Promise<unknown>,
  options: { dryRun?: boolean } = {},
): { ctx: DeployContext; logs: string[] } {
  const logs: string[] = [];
  return {
    ctx: {
      region: "us-east-1",
      accountId: "111122223333",
      dryRun: options.dryRun ?? false,
      repoRoot: ".",
      appPrefix: "provisionless",
      mediaBucket: "provisionless-media",
      log: (message: string) => logs.push(message),
      clients: { ses: { send } } as unknown as AwsClients,
    },
    logs,
  };
}

it("creates the SES identity when it does not exist and asks for verification", async () => {
  const commands: unknown[] = [];
  const { ctx, logs } = createContext(async (command) => {
    commands.push(command);
    if (command instanceof GetEmailIdentityCommand) {
      const error = new Error("missing");
      error.name = "NotFoundException";
      throw error;
    }
    return { VerifiedForSendingStatus: false };
  });

  const result = await ensureEmailIdentity(ctx, "no-reply@example.com");

  expect(result).toEqual({ identity: "no-reply@example.com", verified: false });
  expect(commands.some((command) => command instanceof CreateEmailIdentityCommand)).toBe(true);
  expect(logs.some((message) => message.includes("SES sent a verification email"))).toBe(true);
});

it("reuses an existing verified identity", async () => {
  const commands: unknown[] = [];
  const { ctx, logs } = createContext(async (command) => {
    commands.push(command);
    return { VerifiedForSendingStatus: true };
  });

  const result = await ensureEmailIdentity(ctx, "no-reply@example.com");

  expect(result.verified).toBe(true);
  expect(commands.some((command) => command instanceof CreateEmailIdentityCommand)).toBe(false);
  expect(logs.some((message) => message.includes("reusing verified SES email identity"))).toBe(
    true,
  );
});

it("reports an existing identity that is still pending verification", async () => {
  const { ctx, logs } = createContext(async () => ({ VerifiedForSendingStatus: false }));

  const result = await ensureEmailIdentity(ctx, "no-reply@example.com");

  expect(result.verified).toBe(false);
  expect(logs.some((message) => message.includes("is not verified yet"))).toBe(true);
});

it("does not call SES during a dry run", async () => {
  let calls = 0;
  const { ctx, logs } = createContext(
    async () => {
      calls += 1;
      return {};
    },
    { dryRun: true },
  );

  const result = await ensureEmailIdentity(ctx, "no-reply@example.com");

  expect(result).toEqual({ identity: "no-reply@example.com", verified: false });
  expect(calls).toBe(0);
  expect(logs.some((message) => message.includes("would create or reuse SES email identity"))).toBe(
    true,
  );
});
