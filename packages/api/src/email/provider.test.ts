import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { User } from "@provisionless/core";
import { expect, it } from "vitest";

import {
  buildResetEmail,
  createEmailProviderFromEnv,
  createLoggingEmailProvider,
  createResetEmailDelivery,
  createSesEmailProvider,
  type EmailProvider,
  type EmailSender,
  type ResetEmailMessage,
} from "./provider.ts";

const user: User = {
  username: "ada",
  id: "11111111-1111-1111-1111-111111111111",
  passwordHash: "hash",
  email: "ada@example.com",
  isAdmin: true,
  firstName: "Ada",
  lastName: "Lovelace",
  enabled: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  passwordChangedAt: "2026-01-01T00:00:00.000Z",
};

const message: ResetEmailMessage = {
  to: "ada@example.com",
  username: "ada",
  resetUrl: "https://admin.example.com/reset?token=abc123",
};

function fakeSender() {
  const commands: SendEmailCommand[] = [];
  const sender = {
    send: async (command: SendEmailCommand) => {
      commands.push(command);
      return {};
    },
  } as unknown as EmailSender;
  return { sender, commands };
}

it("builds a reset email with text and HTML that link to the reset URL", () => {
  const content = buildResetEmail(message);

  expect(content.subject).toBe("Reset your Provisionless password");
  expect(content.text).toContain("Hi ada,");
  expect(content.text).toContain(message.resetUrl);
  expect(content.html).toContain(`href="${message.resetUrl}"`);
  expect(content.html).toContain("Choose a new password");
});

it("escapes user-controlled values in the HTML body", () => {
  const content = buildResetEmail({
    ...message,
    username: "ada<script>",
    resetUrl: "https://admin.example.com/reset?token=a&b",
  });

  expect(content.html).not.toContain("<script>");
  expect(content.html).toContain("ada&lt;script&gt;");
  expect(content.html).toContain("a&amp;b");
});

it("logs the reset link with the logging provider", async () => {
  const logs: string[] = [];
  const provider = createLoggingEmailProvider({ log: (line) => logs.push(line) });

  await provider.sendResetEmail(message);

  expect(logs).toEqual([`Password reset link for ada: ${message.resetUrl}`]);
});

it("sends a reset email through SES with the configured sender", async () => {
  const { sender, commands } = fakeSender();
  const provider = createSesEmailProvider({
    client: sender,
    fromAddress: "no-reply@example.com",
    fromName: "Provisionless",
  });

  await provider.sendResetEmail(message);

  expect(commands).toHaveLength(1);
  const input = commands[0]?.input;
  expect(input?.FromEmailAddress).toBe("Provisionless <no-reply@example.com>");
  expect(input?.Destination?.ToAddresses).toEqual(["ada@example.com"]);
  expect(input?.Content?.Simple?.Subject?.Data).toBe("Reset your Provisionless password");
  expect(input?.Content?.Simple?.Body?.Text?.Data).toContain(message.resetUrl);
  expect(input?.Content?.Simple?.Body?.Html?.Data).toContain(message.resetUrl);
});

it("uses the sender address as-is when no display name is configured", async () => {
  const { sender, commands } = fakeSender();
  const provider = createSesEmailProvider({ client: sender, fromAddress: "no-reply@example.com" });

  await provider.sendResetEmail(message);

  expect(commands[0]?.input.FromEmailAddress).toBe("no-reply@example.com");
});

it("selects the logging provider when no sender address is configured", async () => {
  const logs: string[] = [];
  const provider = createEmailProviderFromEnv({
    env: {},
    log: (line) => logs.push(line),
  });

  expect(provider.channel).toBe("log");
  await provider.sendResetEmail(message);
  expect(logs[0]).toContain(message.resetUrl);
});

it("selects SES when a sender address is configured", async () => {
  const { sender, commands } = fakeSender();
  const provider = createEmailProviderFromEnv({
    env: { EMAIL_FROM_ADDRESS: "no-reply@example.com", EMAIL_FROM_NAME: "Provisionless" },
    client: sender,
  });

  expect(provider.channel).toBe("ses");
  await provider.sendResetEmail(message);
  expect(commands[0]?.input.FromEmailAddress).toBe("Provisionless <no-reply@example.com>");
});

it("builds the reset link from the admin URL and delivers to the user's address", async () => {
  const sent: ResetEmailMessage[] = [];
  const provider: EmailProvider = {
    channel: "ses",
    sendResetEmail: (email) => {
      sent.push(email);
      return Promise.resolve();
    },
  };
  const deliver = createResetEmailDelivery({
    provider,
    adminBaseUrl: "https://admin.example.com/",
  });

  await deliver(user, "token with spaces");

  expect(sent).toEqual([
    {
      to: "ada@example.com",
      username: "ada",
      resetUrl: "https://admin.example.com/reset?token=token%20with%20spaces",
    },
  ]);
});

it("logs the link when the logging provider is active and the user has no email", async () => {
  const logs: string[] = [];
  const deliver = createResetEmailDelivery({
    provider: createLoggingEmailProvider({ log: (line) => logs.push(line) }),
    adminBaseUrl: "http://localhost:3001",
    log: (line) => logs.push(line),
  });

  await deliver({ ...user, email: "" }, "token-1");

  expect(logs).toEqual(["Password reset link for ada: http://localhost:3001/reset?token=token-1"]);
});

it("does not log the link when SES is active but the user has no email", async () => {
  const logs: string[] = [];
  const provider: EmailProvider = {
    channel: "ses",
    sendResetEmail: () => {
      throw new Error("should not send");
    },
  };
  const deliver = createResetEmailDelivery({
    provider,
    adminBaseUrl: "https://admin.example.com",
    log: (line) => logs.push(line),
  });

  await deliver({ ...user, email: "" }, "token-1");

  expect(logs).toEqual([
    "Cannot send a password reset email to ada: the user has no email address.",
  ]);
});

it("logs delivery failures without failing the reset request", async () => {
  const logs: string[] = [];
  const provider: EmailProvider = {
    channel: "ses",
    sendResetEmail: () => Promise.reject(new Error("SES is not verified")),
  };
  const deliver = createResetEmailDelivery({
    provider,
    adminBaseUrl: "https://admin.example.com",
    log: (line) => logs.push(line),
  });

  await expect(deliver(user, "token-1")).resolves.toBeUndefined();
  expect(logs).toEqual(["Failed to send a password reset email to ada: SES is not verified"]);
});
