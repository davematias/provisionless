import { z } from "zod";

export const ErrorResponseSchema = z.object({
  error: z.string(),
});

export const FieldErrorSchema = z.object({
  field: z.string(),
  message: z.string(),
});

export const ValidationErrorSchema = ErrorResponseSchema.extend({
  errors: z.array(FieldErrorSchema),
});

export const PublicUserSchema = z.object({
  username: z.string(),
  id: z.string(),
  email: z.string(),
  isAdmin: z.boolean(),
  firstName: z.string(),
  lastName: z.string(),
  pictureUrl: z.string().optional(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

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

export const HealthResponseSchema = z.object({ status: z.string() });
export const OkResponseSchema = z.object({ ok: z.boolean() });
export const UserResponseSchema = z.object({ user: PublicUserSchema });
export const UsersResponseSchema = z.object({ users: z.array(PublicUserSchema) });
export const ResetLinkResponseSchema = z.object({ username: z.string(), url: z.string() });
export const ContentTypeResponseSchema = z.object({ contentType: ContentTypeSchema });
export const ContentTypesResponseSchema = z.object({ contentTypes: z.array(ContentTypeSchema) });
export const ContentEntryResponseSchema = z.object({ entry: ContentEntrySchema });
export const ContentEntriesResponseSchema = z.object({ entries: z.array(ContentEntrySchema) });

export const LoginRequestSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export const ResetRequestSchema = z.object({ username: z.string() });

export const ResetLinkRequestSchema = z.object({ username: z.string() });

export const ResetConfirmSchema = z.object({
  token: z.string(),
  password: z.string(),
});

export const CreateUserRequestSchema = z.object({
  username: z.string(),
  password: z.string(),
  email: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  isAdmin: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

export const UpdateUserRequestSchema = z.object({
  enabled: z.boolean().optional(),
  isAdmin: z.boolean().optional(),
  email: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

export const ContentTypeRequestSchema = z.object({
  name: z.string(),
  fields: z.array(ContentFieldSchema),
});

export const ContentEntryRequestSchema = z.object({
  values: ContentEntryValuesSchema,
});
