import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { User } from "@provisionless/core";

import { buildResetUrl } from "../auth/reset-link.ts";

export interface ResetEmailMessage {
  to: string;
  username: string;
  resetUrl: string;
}

export interface EmailProvider {
  /** How the provider delivers mail; used to decide whether a reset link may be logged. */
  readonly channel: "log" | "ses";
  sendResetEmail(message: ResetEmailMessage): Promise<void>;
}

export interface ResetEmailContent {
  subject: string;
  text: string;
  html: string;
}

const SUBJECT = "Reset your Provisionless password";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildResetEmail(message: ResetEmailMessage): ResetEmailContent {
  const username = escapeHtml(message.username);
  const url = escapeHtml(message.resetUrl);
  const text = [
    `Hi ${message.username},`,
    "",
    "We received a request to reset the password for your Provisionless account.",
    "",
    "Choose a new password (the link is valid for one hour):",
    message.resetUrl,
    "",
    "If you did not request a password reset, you can ignore this email.",
  ].join("\n");

  const html = [
    `<p>Hi ${username},</p>`,
    "<p>We received a request to reset the password for your Provisionless account.</p>",
    `<p><a href="${url}">Choose a new password</a> (the link is valid for one hour).</p>`,
    `<p>Or open this link: <a href="${url}">${url}</a></p>`,
    "<p>If you did not request a password reset, you can ignore this email.</p>",
  ].join("\n");

  return { subject: SUBJECT, text, html };
}

export interface LoggingEmailProviderOptions {
  log?: (message: string) => void;
}

export function createLoggingEmailProvider(
  options: LoggingEmailProviderOptions = {},
): EmailProvider {
  const log = options.log ?? console.log;
  return {
    channel: "log",
    sendResetEmail(message) {
      log(`Password reset link for ${message.username}: ${message.resetUrl}`);
      return Promise.resolve();
    },
  };
}

export type EmailSender = Pick<SESv2Client, "send">;

export interface SesEmailProviderOptions {
  client: EmailSender;
  fromAddress: string;
  fromName?: string;
}

export function createSesEmailProvider(options: SesEmailProviderOptions): EmailProvider {
  const from = options.fromName
    ? `${options.fromName} <${options.fromAddress}>`
    : options.fromAddress;

  return {
    channel: "ses",
    async sendResetEmail(message) {
      const content = buildResetEmail(message);
      await options.client.send(
        new SendEmailCommand({
          FromEmailAddress: from,
          Destination: { ToAddresses: [message.to] },
          Content: {
            Simple: {
              Subject: { Data: content.subject, Charset: "UTF-8" },
              Body: {
                Text: { Data: content.text, Charset: "UTF-8" },
                Html: { Data: content.html, Charset: "UTF-8" },
              },
            },
          },
        }),
      );
    },
  };
}

export interface EmailEnvironment {
  EMAIL_FROM_ADDRESS?: string | undefined;
  EMAIL_FROM_NAME?: string | undefined;
}

export interface EmailProviderFromEnvOptions {
  env: EmailEnvironment;
  client?: EmailSender;
  log?: (message: string) => void;
}

/**
 * Uses SES when a sender address is configured, otherwise logs reset links so the flow works
 * locally without any email setup.
 */
export function createEmailProviderFromEnv(options: EmailProviderFromEnvOptions): EmailProvider {
  const fromAddress = options.env.EMAIL_FROM_ADDRESS?.trim();
  if (!fromAddress) {
    return createLoggingEmailProvider({ log: options.log });
  }
  const fromName = options.env.EMAIL_FROM_NAME?.trim() || undefined;
  return createSesEmailProvider({
    client: options.client ?? new SESv2Client({}),
    fromAddress,
    fromName,
  });
}

export interface ResetEmailDeliveryOptions {
  provider: EmailProvider;
  adminBaseUrl: string;
  log?: (message: string) => void;
}

export type ResetEmailDelivery = (user: User, token: string) => Promise<void>;

/**
 * Builds the reset link from the admin URL and hands it to the configured provider. Delivery
 * failures are logged rather than failing the request, so the reset endpoint keeps returning the
 * same response whether or not an account exists.
 */
export function createResetEmailDelivery(options: ResetEmailDeliveryOptions): ResetEmailDelivery {
  const log = options.log ?? console.log;

  return async (user, token) => {
    const resetUrl = buildResetUrl(options.adminBaseUrl, token);

    if (!user.email) {
      if (options.provider.channel === "log") {
        log(`Password reset link for ${user.username}: ${resetUrl}`);
      } else {
        log(
          `Cannot send a password reset email to ${user.username}: the user has no email address.`,
        );
      }
      return;
    }

    try {
      await options.provider.sendResetEmail({
        to: user.email,
        username: user.username,
        resetUrl,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log(`Failed to send a password reset email to ${user.username}: ${reason}`);
    }
  };
}
