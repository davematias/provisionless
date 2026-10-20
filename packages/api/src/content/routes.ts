import {
  validateContentEntryValues,
  validateContentType,
  type ContentType,
  type ContentTypeInput,
} from "@provisionless/core";
import type { Hono } from "hono";
import { describeRoute } from "hono-openapi";

import { requireAdmin, requireAuth } from "../auth/middleware.ts";
import type { AppEnv, SessionDependencies } from "../auth/session.ts";
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
  OkResponseSchema,
} from "../openapi/schemas.ts";
import type { ContentEntryStore, ContentTypeStore } from "./store.ts";

export interface ContentRoutesDependencies extends SessionDependencies {
  contentTypes: ContentTypeStore;
  contentEntries: ContentEntryStore;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function findContentType(
  deps: ContentRoutesDependencies,
  slug: string,
): Promise<ContentType | undefined> {
  return deps.contentTypes.get(slug);
}

export function registerContentRoutes(app: Hono<AppEnv>, deps: ContentRoutesDependencies): void {
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
      const contentTypes = (await deps.contentTypes.list()).sort((left, right) =>
        left.slug.localeCompare(right.slug),
      );
      return c.json({ contentTypes });
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
      const contentType = await findContentType(deps, c.req.param("slug"));
      if (!contentType) {
        return c.json({ error: "Content type not found" }, 404);
      }
      return c.json({ contentType });
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

      const candidate = {
        slug: c.req.param("slug"),
        name: body.name,
        fields: body.fields,
      };
      const errors = validateContentType(candidate);
      if (errors.length > 0) {
        return c.json({ error: "Invalid content type", errors }, 400);
      }

      const contentType = await deps.contentTypes.put(candidate as ContentTypeInput);
      return c.json({ contentType });
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
      const slug = c.req.param("slug");
      const contentType = await findContentType(deps, slug);
      if (!contentType) {
        return c.json({ error: "Content type not found" }, 404);
      }

      await deps.contentEntries.deleteByType(slug);
      await deps.contentTypes.delete(slug);
      return c.json({ ok: true });
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
      const slug = c.req.param("slug");
      const contentType = await findContentType(deps, slug);
      if (!contentType) {
        return c.json({ error: "Content type not found" }, 404);
      }

      const entries = await deps.contentEntries.list(slug);
      return c.json({ entries });
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
      const slug = c.req.param("slug");
      const contentType = await findContentType(deps, slug);
      if (!contentType) {
        return c.json({ error: "Content type not found" }, 404);
      }

      const entry = await deps.contentEntries.get(slug, c.req.param("id"));
      if (!entry) {
        return c.json({ error: "Content entry not found" }, 404);
      }
      return c.json({ entry });
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
      const slug = c.req.param("slug");
      const contentType = await findContentType(deps, slug);
      if (!contentType) {
        return c.json({ error: "Content type not found" }, 404);
      }

      const body = await c.req.json().catch(() => undefined);
      if (!isRecord(body) || body.values === undefined) {
        return c.json({ error: "values is required" }, 400);
      }

      const errors = validateContentEntryValues(contentType, body.values);
      if (errors.length > 0) {
        return c.json({ error: "Invalid content entry", errors }, 400);
      }

      const entry = await deps.contentEntries.create(contentType, body.values);
      return c.json({ entry }, 201);
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
      const slug = c.req.param("slug");
      const contentType = await findContentType(deps, slug);
      if (!contentType) {
        return c.json({ error: "Content type not found" }, 404);
      }

      const body = await c.req.json().catch(() => undefined);
      if (!isRecord(body) || body.values === undefined) {
        return c.json({ error: "values is required" }, 400);
      }

      const errors = validateContentEntryValues(contentType, body.values);
      if (errors.length > 0) {
        return c.json({ error: "Invalid content entry", errors }, 400);
      }

      const entryId = c.req.param("id");
      const existing = await deps.contentEntries.get(slug, entryId);
      if (!existing) {
        return c.json({ error: "Content entry not found" }, 404);
      }

      const entry = await deps.contentEntries.update(contentType, entryId, body.values);
      return c.json({ entry });
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
      const slug = c.req.param("slug");
      const contentType = await findContentType(deps, slug);
      if (!contentType) {
        return c.json({ error: "Content type not found" }, 404);
      }

      const deleted = await deps.contentEntries.delete(slug, c.req.param("id"));
      if (!deleted) {
        return c.json({ error: "Content entry not found" }, 404);
      }
      return c.json({ ok: true });
    },
  );
}
