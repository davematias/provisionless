import { CreateEmailIdentityCommand, GetEmailIdentityCommand } from "@aws-sdk/client-sesv2";

import { isAwsError } from "../util/aws.ts";
import type { DeployContext } from "./context.ts";

export interface EmailIdentity {
  identity: string;
  verified: boolean;
}

/**
 * Creates the SES identity for the configured sender, or reuses it when it already exists. SES
 * sends a verification email for a new address identity; sending fails until it is verified.
 */
export async function ensureEmailIdentity(
  ctx: DeployContext,
  identity: string,
): Promise<EmailIdentity> {
  if (ctx.dryRun) {
    ctx.log(`would create or reuse SES email identity ${identity}`);
    return { identity, verified: false };
  }

  try {
    const existing = await ctx.clients.ses.send(
      new GetEmailIdentityCommand({ EmailIdentity: identity }),
    );
    const verified = existing.VerifiedForSendingStatus === true;
    ctx.log(
      verified
        ? `reusing verified SES email identity ${identity}`
        : `SES email identity ${identity} is not verified yet; password reset emails will fail until it is verified`,
    );
    return { identity, verified };
  } catch (error) {
    if (!isAwsError(error, "NotFoundException")) {
      throw error;
    }
  }

  ctx.log(`creating SES email identity ${identity}`);
  const created = await ctx.clients.ses.send(
    new CreateEmailIdentityCommand({ EmailIdentity: identity }),
  );
  const verified = created.VerifiedForSendingStatus === true;
  if (!verified) {
    ctx.log(
      `SES sent a verification email to ${identity}; follow its link before password reset emails can be delivered`,
    );
  }
  return { identity, verified };
}
