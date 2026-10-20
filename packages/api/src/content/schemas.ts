import { z } from "zod";

export const ContentFieldSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "boolean"]),
  required: z.boolean().optional(),
});

export const ContentTypeSchema = z.object({
  slug: z.string(),
  name: z.string(),
  fields: z.array(ContentFieldSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ContentEntryValuesSchema = z
  .object({})
  .catchall(z.any())
  .describe("Field values keyed by field name; each value is a string or boolean");

export const ContentEntrySchema = z.object({
  type: z.string(),
  id: z.string(),
  values: ContentEntryValuesSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ContentTypeResponseSchema = z.object({ contentType: ContentTypeSchema });
export const ContentTypesResponseSchema = z.object({ contentTypes: z.array(ContentTypeSchema) });
export const ContentEntryResponseSchema = z.object({ entry: ContentEntrySchema });
export const ContentEntriesResponseSchema = z.object({ entries: z.array(ContentEntrySchema) });

export const ContentTypeRequestSchema = z.object({
  name: z.string(),
  fields: z.array(ContentFieldSchema),
});

export const ContentEntryRequestSchema = z.object({
  values: ContentEntryValuesSchema,
});
