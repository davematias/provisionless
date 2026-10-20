import { resolver } from "hono-openapi";

import { ErrorResponseSchema, ValidationErrorSchema } from "./schemas.ts";

type Schema = Parameters<typeof resolver>[0];

export const SECURITY = [{ cookieAuth: [] }];

export function jsonResponse(schema: Schema, description: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: resolver(schema),
      },
    },
  };
}

export function jsonRequest(schema: Schema) {
  return {
    required: true,
    content: {
      "application/json": {
        schema: resolver(schema),
      },
    },
  };
}

export function errorResponse(description: string) {
  return jsonResponse(ErrorResponseSchema, description);
}

export function validationErrorResponse(description = "Invalid request") {
  return jsonResponse(ValidationErrorSchema, description);
}

export function pathParameter(name: string) {
  return {
    name,
    in: "path" as const,
    required: true,
    schema: { type: "string" as const },
  };
}
