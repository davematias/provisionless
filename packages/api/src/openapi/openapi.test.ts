import SwaggerParser from "@apidevtools/swagger-parser";
import { expect, it } from "vitest";

import { createApp } from "../app.ts";
import type { ContentEntryStore, ContentTypeStore } from "../content/store.ts";
import type { UserManagementStore } from "../users/store.ts";

const users = {
  getUser: async () => undefined,
  createUser: async () => {
    throw new Error("not used");
  },
  listUsers: async () => [],
  updateUser: async () => {
    throw new Error("not used");
  },
} as unknown as UserManagementStore;

const contentTypes = {
  get: async () => undefined,
  list: async () => [],
  put: async () => {
    throw new Error("not used");
  },
  delete: async () => false,
} as ContentTypeStore;

const contentEntries = {
  get: async () => undefined,
  list: async () => [],
  create: async () => {
    throw new Error("not used");
  },
  update: async () => {
    throw new Error("not used");
  },
  delete: async () => false,
  deleteByType: async () => 0,
} as ContentEntryStore;

function buildApp() {
  return createApp({
    users,
    resetTokens: { create: async () => "token", consume: async () => undefined },
    contentTypes,
    contentEntries,
    jwtSecret: "test-secret",
    secureCookies: false,
  });
}

interface Spec {
  openapi: string;
  paths: Record<string, Record<string, { security?: unknown[] }>>;
  components: {
    securitySchemes: Record<string, Record<string, unknown>>;
  };
}

it("serves a valid OpenAPI 3.0 document for every route", async () => {
  const response = await buildApp().request("/openapi.json");

  expect(response.status).toBe(200);
  const spec = (await response.json()) as Spec;
  expect(spec.openapi).toBe("3.0.3");

  const expected: Record<string, string[]> = {
    "/health": ["get"],
    "/auth/login": ["post"],
    "/auth/logout": ["post"],
    "/auth/me": ["get"],
    "/auth/reset/request": ["post"],
    "/auth/reset/link": ["post"],
    "/auth/reset/confirm": ["post"],
    "/users": ["get", "post"],
    "/users/{username}": ["patch"],
    "/content-types": ["get"],
    "/content-types/{slug}": ["get", "put", "delete"],
    "/content/{slug}": ["get", "post"],
    "/content/{slug}/{id}": ["get", "put", "delete"],
  };
  for (const [path, methods] of Object.entries(expected)) {
    expect(spec.paths[path], path).toBeDefined();
    for (const method of methods) {
      expect(spec.paths[path]?.[method], `${method.toUpperCase()} ${path}`).toBeDefined();
    }
  }

  expect(spec.paths["/auth/me"]?.get?.security).toEqual([{ cookieAuth: [] }]);
  expect(spec.paths["/auth/login"]?.post?.security).toBeUndefined();
  expect(spec.components.securitySchemes.cookieAuth).toMatchObject({
    type: "apiKey",
    in: "cookie",
    name: "provisionless_session",
  });

  await expect(SwaggerParser.validate(spec as never)).resolves.toBeDefined();
});

it("documents request and response schemas", async () => {
  const response = await buildApp().request("/openapi.json");
  const spec = (await response.json()) as {
    paths: Record<
      string,
      Record<
        string,
        {
          requestBody?: { content?: Record<string, { schema?: unknown }> };
          responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
        }
      >
    >;
  };

  expect(
    spec.paths["/auth/login"]?.post?.requestBody?.content?.["application/json"]?.schema,
  ).toBeDefined();
  expect(
    spec.paths["/content-types/{slug}"]?.put?.requestBody?.content?.["application/json"]?.schema,
  ).toBeDefined();
  expect(
    spec.paths["/content/{slug}"]?.post?.responses?.["201"]?.content?.["application/json"]?.schema,
  ).toBeDefined();
});
