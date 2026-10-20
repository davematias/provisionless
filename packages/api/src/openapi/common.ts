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

export const OkResponseSchema = z.object({ ok: z.boolean() });
