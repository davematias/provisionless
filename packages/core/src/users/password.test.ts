import { expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password.ts";

it("hashes a password without keeping the plaintext", async () => {
  const hash = await hashPassword("correct horse battery staple");

  expect(hash).not.toContain("correct horse battery staple");
  expect(hash.startsWith("scrypt:")).toBe(true);
});

it("verifies a correct password", async () => {
  const hash = await hashPassword("s3cret");

  expect(await verifyPassword("s3cret", hash)).toBe(true);
});

it("rejects an incorrect password", async () => {
  const hash = await hashPassword("s3cret");

  expect(await verifyPassword("wrong", hash)).toBe(false);
});

it("uses a distinct salt for each hash", async () => {
  const [first, second] = await Promise.all([hashPassword("same"), hashPassword("same")]);

  expect(first).not.toBe(second);
});
