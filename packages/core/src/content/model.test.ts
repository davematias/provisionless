import { expect, it } from "vitest";

import { validateContentEntryValues, validateContentType, type ContentType } from "./model.ts";

it("accepts a valid content type", () => {
  const errors = validateContentType({
    slug: "blog-post",
    name: "Blog post",
    fields: [
      { name: "title", type: "string", required: true },
      { name: "published", type: "boolean" },
    ],
  });

  expect(errors).toEqual([]);
});

it("rejects an invalid slug and empty name", () => {
  const errors = validateContentType({
    slug: "Blog Post",
    name: "  ",
    fields: [{ name: "title", type: "string" }],
  });

  expect(errors.map((error) => error.field)).toEqual(["slug", "name"]);
});

it("requires at least one field", () => {
  const errors = validateContentType({ slug: "post", name: "Post", fields: [] });

  expect(errors).toEqual([{ field: "fields", message: "At least one field is required" }]);
});

it("rejects empty and duplicate field names", () => {
  const errors = validateContentType({
    slug: "post",
    name: "Post",
    fields: [
      { name: "", type: "string" },
      { name: "title", type: "string" },
      { name: "title", type: "boolean" },
    ],
  });

  expect(errors.map((error) => error.field)).toEqual(["fields[0].name", "fields[2].name"]);
});

it("rejects unsupported field types and non-boolean required values", () => {
  const errors = validateContentType({
    slug: "post",
    name: "Post",
    fields: [
      { name: "title", type: "number" as never },
      { name: "published", type: "boolean", required: "yes" as never },
    ],
  });

  expect(errors.map((error) => error.field)).toEqual(["fields[0].type", "fields[1].required"]);
});

const contentType: ContentType = {
  slug: "post",
  name: "Post",
  fields: [
    { name: "title", type: "string", required: true },
    { name: "published", type: "boolean", required: true },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

it("accepts entry values that match the schema", () => {
  expect(validateContentEntryValues(contentType, { title: "", published: false })).toEqual([]);
});

it("rejects missing required fields", () => {
  const errors = validateContentEntryValues(contentType, { title: "Hello" });

  expect(errors).toEqual([{ field: "published", message: "Field is required" }]);
});

it("rejects wrong value types", () => {
  const errors = validateContentEntryValues(contentType, { title: 42, published: "yes" });

  expect(errors).toEqual([
    { field: "title", message: "Expected a string" },
    { field: "published", message: "Expected a boolean" },
  ]);
});

it("rejects unknown fields and non-object values", () => {
  expect(
    validateContentEntryValues(contentType, { title: "Hi", published: true, extra: 1 }),
  ).toEqual([{ field: "extra", message: "Unknown field" }]);
  expect(validateContentEntryValues(contentType, null)).toEqual([
    { field: "values", message: "Values must be an object" },
  ]);
});
