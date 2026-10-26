import type { Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";

import { requireAdmin, requireAuth } from "../auth/middleware.ts";
import type { AppEnv, SessionDependencies } from "../auth/session.ts";
import { OkResponseSchema } from "../openapi/common.ts";
import {
  errorResponse,
  jsonRequest,
  jsonResponse,
  pathParameter,
  SECURITY,
  validationErrorResponse,
} from "../openapi/helpers.ts";
import {
  ContentEntriesResponseSchema,
  ContentEntryRequestSchema,
  ContentEntryResponseSchema,
  ContentTypeRequestSchema,
  ContentTypeResponseSchema,
  ContentTypesResponseSchema,
} from "./schemas.ts";
import {
  ContentEntryNotFoundError,
  ContentEntryValidationError,
  ContentService,
  ContentTypeNotFoundError,
  ContentTypeValidationError,
} from "./service.ts";
import type { ContentEntryStore, ContentTypeStore } from "./store.ts";

export interface ContentRoutesDependencies extends SessionDependencies {
  contentTypes: ContentTypeStore;
  contentEntries: ContentEntryStore;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mappedError(c: Context<AppEnv>, error: unknown): Response | undefined {
  if (error instanceof ContentTypeNotFoundError) {
    return c.json({ error: "Content type not found" }, 404);
  }
  if (error instanceof ContentEntryNotFoundError) {
    return c.json({ error: "Content entry not found" }, 404);
  }
  if (error instanceof ContentTypeValidationError) {
    return c.json({ error: "Invalid content type", errors: error.errors }, 400);
  }
  if (error instanceof ContentEntryValidationError) {
    return c.json({ error: "Invalid content entry", errors: error.errors }, 400);
  }
  return undefined;
}

export function registerContentRoutes(app: Hono<AppEnv>, deps: ContentRoutesDependencies): void {
  const content = new ContentService(deps.contentTypes, deps.contentEntries);

  app.get(
    "/content-types",
    describeRoute({
      tags: ["Content types"],
      summary: "List content schemas",
      operationId: "listContentTypes",
      security: SECURITY,
      responses: {
        200: jsonResponse(ContentTypesResponseSchema, "Content types"),
        401: errorResponse("Unauthorized"),
        403: errorResponse("Forbidden"),
      },
    }),
    requireAdmin(deps),
    async (c) => {
      return c.json({ contentTypes: await content.listContentTypes() });
    },
  );

  app.get(
    "/content-types/:slug",
    describeRoute({
      tags: ["Content types"],
      summary: "Read a content schema",
      operationId: "getContentType",
      security: SECURITY,
      parameters: [pathParameter("slug")],
      responses: {
        200: jsonResponse(ContentTypeResponseSchema, "Content type"),
        401: errorResponse("Unauthorized"),
        403: errorResponse("Forbidden"),
        404: errorResponse("Content type not found"),
      },
    }),
    requireAdmin(deps),
    async (c) => {
      try {
        return c.json({ contentType: await content.getContentType(c.req.param("slug")) });
      } catch (error) {
        const mapped = mappedError(c, error);
        if (mapped) {
          return mapped;
        }
        throw error;
      }
    },
  );

  app.put(
    "/content-types/:slug",
    describeRoute({
      tags: ["Content types"],
      summary: "Create or replace a content schema",
      operationId: "putContentType",
      security: SECURITY,
      parameters: [pathParameter("slug")],
      requestBody: jsonRequest(ContentTypeRequestSchema),
      responses: {
        200: jsonResponse(ContentTypeResponseSchema, "Content type saved"),
        400: validationErrorResponse("Invalid content type"),
        401: errorResponse("Unauthorized"),
        403: errorResponse("Forbidden"),
      },
    }),
    requireAdmin(deps),
    async (c) => {
      const body = await c.req.json().catch(() => undefined);
      if (!isRecord(body)) {
        return c.json({ error: "A JSON body is required" }, 400);
      }

      try {
        const contentType = await content.putContentType(c.req.param("slug"), body);
        return c.json({ contentType });
      } catch (error) {
        const mapped = mappedError(c, error);
        if (mapped) {
          return mapped;
        }
        throw error;
      }
    },
  );

  app.delete(
    "/content-types/:slug",
    describeRoute({
      tags: ["Content types"],
      summary: "Delete a content schema and its entries",
      operationId: "deleteContentType",
      security: SECURITY,
      parameters: [pathParameter("slug")],
      responses: {
        200: jsonResponse(OkResponseSchema, "Content type deleted"),
        401: errorResponse("Unauthorized"),
        403: errorResponse("Forbidden"),
        404: errorResponse("Content type not found"),
      },
    }),
    requireAdmin(deps),
    async (c) => {
      try {
        await content.deleteContentType(c.req.param("slug"));
        return c.json({ ok: true });
      } catch (error) {
        const mapped = mappedError(c, error);
        if (mapped) {
          return mapped;
        }
        throw error;
      }
    },
  );

  app.get(
    "/content/:slug",
    describeRoute({
      tags: ["Content"],
      summary: "List entries for a content type",
      operationId: "listContentEntries",
      security: SECURITY,
      parameters: [pathParameter("slug")],
      responses: {
        200: jsonResponse(ContentEntriesResponseSchema, "Content entries"),
        401: errorResponse("Unauthorized"),
        404: errorResponse("Content type not found"),
      },
    }),
    requireAuth(deps),
    async (c) => {
      try {
        return c.json({ entries: await content.listEntries(c.req.param("slug")) });
      } catch (error) {
        const mapped = mappedError(c, error);
        if (mapped) {
          return mapped;
        }
        throw error;
      }
    },
  );

  app.get(
    "/content/:slug/:id",
    describeRoute({
      tags: ["Content"],
      summary: "Read a content entry",
      operationId: "getContentEntry",
      security: SECURITY,
      parameters: [pathParameter("slug"), pathParameter("id")],
      responses: {
        200: jsonResponse(ContentEntryResponseSchema, "Content entry"),
        401: errorResponse("Unauthorized"),
        404: errorResponse("Content entry not found"),
      },
    }),
    requireAuth(deps),
    async (c) => {
      try {
        const entry = await content.getEntry(c.req.param("slug"), c.req.param("id"));
        return c.json({ entry });
      } catch (error) {
        const mapped = mappedError(c, error);
        if (mapped) {
          return mapped;
        }
        throw error;
      }
    },
  );

  app.post(
    "/content/:slug",
    describeRoute({
      tags: ["Content"],
      summary: "Create a content entry",
      operationId: "createContentEntry",
      security: SECURITY,
      parameters: [pathParameter("slug")],
      requestBody: jsonRequest(ContentEntryRequestSchema),
      responses: {
        201: jsonResponse(ContentEntryResponseSchema, "Content entry created"),
        400: validationErrorResponse("Invalid content entry"),
        401: errorResponse("Unauthorized"),
        404: errorResponse("Content type not found"),
      },
    }),
    requireAuth(deps),
    async (c) => {
      const body = await c.req.json().catch(() => undefined);
      if (!isRecord(body) || body.values === undefined) {
        return c.json({ error: "values is required" }, 400);
      }

      try {
        const entry = await content.createEntry(c.req.param("slug"), body.values);
        return c.json({ entry }, 201);
      } catch (error) {
        const mapped = mappedError(c, error);
        if (mapped) {
          return mapped;
        }
        throw error;
      }
    },
  );

  app.put(
    "/content/:slug/:id",
    describeRoute({
      tags: ["Content"],
      summary: "Replace a content entry",
      operationId: "updateContentEntry",
      security: SECURITY,
      parameters: [pathParameter("slug"), pathParameter("id")],
      requestBody: jsonRequest(ContentEntryRequestSchema),
      responses: {
        200: jsonResponse(ContentEntryResponseSchema, "Content entry updated"),
        400: validationErrorResponse("Invalid content entry"),
        401: errorResponse("Unauthorized"),
        404: errorResponse("Content entry not found"),
      },
    }),
    requireAuth(deps),
    async (c) => {
      const body = await c.req.json().catch(() => undefined);
      if (!isRecord(body) || body.values === undefined) {
        return c.json({ error: "values is required" }, 400);
      }

      try {
        const entry = await content.updateEntry(
          c.req.param("slug"),
          c.req.param("id"),
          body.values,
        );
        return c.json({ entry });
      } catch (error) {
        const mapped = mappedError(c, error);
        if (mapped) {
          return mapped;
        }
        throw error;
      }
    },
  );

  app.delete(
    "/content/:slug/:id",
    describeRoute({
      tags: ["Content"],
      summary: "Delete a content entry",
      operationId: "deleteContentEntry",
      security: SECURITY,
      parameters: [pathParameter("slug"), pathParameter("id")],
      responses: {
        200: jsonResponse(OkResponseSchema, "Content entry deleted"),
        401: errorResponse("Unauthorized"),
        404: errorResponse("Content entry not found"),
      },
    }),
    requireAuth(deps),
    async (c) => {
      try {
        await content.deleteEntry(c.req.param("slug"), c.req.param("id"));
        return c.json({ ok: true });
      } catch (error) {
        const mapped = mappedError(c, error);
        if (mapped) {
          return mapped;
        }
        throw error;
      }
    },
  );
}
