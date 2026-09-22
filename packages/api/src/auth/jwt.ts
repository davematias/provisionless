import { SignJWT, jwtVerify } from "jose";

const encoder = new TextEncoder();

export interface SessionPayload {
  username: string;
  issuedAt: number;
}

export async function signSession(
  username: string,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  return await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(username)
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
    return { username: payload.sub, issuedAt: payload.iat ?? 0 };
  } catch {
    return undefined;
  }
}
