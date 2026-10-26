import { createApp, type AppDependencies } from "../app.ts";

function unused(): never {
  throw new Error("The OpenAPI document is rendered without calling API dependencies");
}

function stubDependencies(): AppDependencies {
  return {
    users: {
      getUser: async () => undefined,
      createUser: unused,
      listUsers: async () => [],
      updateUser: unused,
    },
    resetTokens: { create: unused, consume: async () => undefined },
    contentTypes: {
      get: async () => undefined,
      list: async () => [],
      put: unused,
      delete: async () => false,
    },
    contentEntries: {
      get: async () => undefined,
      list: async () => [],
      create: unused,
      update: unused,
      delete: async () => false,
      deleteByType: async () => 0,
    },
    jwtSecret: "openapi-document",
    secureCookies: false,
  };
}

/**
 * Renders the committed API reference from the route definitions. The app is built with stub
 * dependencies because reading `/openapi.json` never touches storage.
 */
export async function renderOpenApiDocument(): Promise<string> {
  const app = createApp(stubDependencies());
  const response = await app.request("/openapi.json");
  if (!response.ok) {
    throw new Error(`The API returned ${response.status} for /openapi.json`);
  }
  return `${JSON.stringify(await response.json(), null, 2)}\n`;
}
