import { expect, it } from "vitest";

import { isValidEmailAddress } from "./model.ts";

it("accepts addresses with a local part and a dotted domain", () => {
  for (const value of [
    "ada@example.com",
    "a@b.c",
    "first.last@sub.example.co.uk",
    "ada+tag@example.com",
  ]) {
    expect(isValidEmailAddress(value), value).toBe(true);
  }
});

it("rejects addresses without a single @ and a dotted domain", () => {
  for (const value of [
    "not-an-email",
    "ada@example",
    "ada@.example",
    "ada@example.",
    "@example.com",
    "ada@@example.com",
  ]) {
    expect(isValidEmailAddress(value), value).toBe(false);
  }
});

it("rejects addresses containing whitespace", () => {
  for (const value of [
    "ada @example.com",
    "ada@ example.com",
    "ada@example.com ",
    "ada@exa\tmple.com",
  ]) {
    expect(isValidEmailAddress(value), value).toBe(false);
  }
});
