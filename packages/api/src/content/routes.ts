import {
  validateContentEntryValues,
  validateContentType,
  type ContentType,
  type ContentTypeInput,
} from "@provisionless/core";
import type { Hono } from "hono";

import { requireAdmin, requireAuth } from "../auth/middleware.ts";
import type { AppEnv, SessionDependencies } from "../auth/session.ts";
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
  app.get("/content-types/:slug", requireAdmin(deps), async (c) => {
    const contentType = await findContentType(deps, c.req.param("slug"));
    if (!contentType) {
      return c.json({ error: "Content type not found" }, 404);
    }
    return c.json({ contentType });
  });

  app.put("/content-types/:slug", requireAdmin(deps), async (c) => {
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
  });

  app.delete("/content-types/:slug", requireAdmin(deps), async (c) => {
    const slug = c.req.param("slug");
    const contentType = await findContentType(deps, slug);
    if (!contentType) {
      return c.json({ error: "Content type not found" }, 404);
    }

    await deps.contentEntries.deleteByType(slug);
    await deps.contentTypes.delete(slug);
    return c.json({ ok: true });
  });

  app.get("/content/:slug", requireAuth(deps), async (c) => {
    const slug = c.req.param("slug");
    const contentType = await findContentType(deps, slug);
    if (!contentType) {
      return c.json({ error: "Content type not found" }, 404);
    }

    const entries = await deps.contentEntries.list(slug);
    return c.json({ entries });
  });

  app.get("/content/:slug/:id", requireAuth(deps), async (c) => {
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
  });

  app.post("/content/:slug", requireAuth(deps), async (c) => {
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
  });

  app.put("/content/:slug/:id", requireAuth(deps), async (c) => {
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
  });

  app.delete("/content/:slug/:id", requireAuth(deps), async (c) => {
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
  });
}
