import { SignJWT, jwtVerify } from "jose";

const encoder = new TextEncoder();
const PASSWORD_CHANGED_AT_CLAIM = "pwd";

export interface SessionPayload {
  username: string;
  issuedAt: number;
  passwordChangedAt?: string;
}

export interface SessionInput {
  username: string;
  passwordChangedAt?: string;
}

export async function signSession(
  session: SessionInput,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  const claims: Record<string, unknown> = {};
  if (session.passwordChangedAt !== undefined) {
    claims[PASSWORD_CHANGED_AT_CLAIM] = session.passwordChangedAt;
  }

  return await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.username)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(encoder.encode(secret));
}

export async function verifySession(
  token: string,
  secret: string,
): Promise<SessionPayload | undefined> {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret));
    if (typeof payload.sub !== "string") {
      return undefined;
    }

    const session: SessionPayload = { username: payload.sub, issuedAt: payload.iat ?? 0 };
    const passwordChangedAt = payload[PASSWORD_CHANGED_AT_CLAIM];
    if (typeof passwordChangedAt === "string") {
      session.passwordChangedAt = passwordChangedAt;
    }
    return session;
  } catch {
    return undefined;
  }
}
