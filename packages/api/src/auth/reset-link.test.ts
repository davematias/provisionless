import { expect, it } from "vitest";

import { buildResetUrl, DEFAULT_ADMIN_BASE_URL } from "./reset-link.ts";

it("builds the reset link under the admin base URL", () => {
  expect(buildResetUrl("https://admin.example.com", "abc")).toBe(
    "https://admin.example.com/reset?token=abc",
  );
});

it("strips trailing slashes from the base URL", () => {
  expect(buildResetUrl("https://admin.example.com///", "abc")).toBe(
    "https://admin.example.com/reset?token=abc",
  );
  expect(buildResetUrl("/", "abc")).toBe("/reset?token=abc");
  expect(buildResetUrl("", "abc")).toBe("/reset?token=abc");
});

it("uses the local admin URL by default", () => {
  expect(buildResetUrl(DEFAULT_ADMIN_BASE_URL, "abc")).toBe(
    "http://localhost:3001/reset?token=abc",
  );
});

it("encodes the token", () => {
  expect(buildResetUrl("https://admin.example.com", "a b/c?d")).toBe(
    "https://admin.example.com/reset?token=a%20b%2Fc%3Fd",
  );
});
