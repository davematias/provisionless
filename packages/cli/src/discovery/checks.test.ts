import { expect, it } from "vitest";

import { applyChecks, checkDeployment } from "./checks.ts";
import type { Deployment } from "./types.ts";

function deployment(): Deployment {
  return {
    prefix: "demo",
    region: "eu-west-1",
    adminUrl: "https://admin.example.com",
    apiUrl: "https://api.example.com",
    health: "healthy",
    reasons: [],
    resources: [],
    regions: ["eu-west-1"],
  };
}

it("probes the admin page and API OpenAPI document", async () => {
  const urls: string[] = [];
  const checks = await checkDeployment(deployment(), {
    fetchImpl: async (url) => {
      urls.push(String(url));
      return new Response("ok", { status: 200 });
    },
  });

  expect(urls).toEqual(["https://admin.example.com", "https://api.example.com/openapi.json"]);
  expect(checks).toEqual([
    { name: "admin", url: "https://admin.example.com", reachable: true, status: 200 },
    {
      name: "api",
      url: "https://api.example.com/openapi.json",
      reachable: true,
      status: 200,
    },
  ]);
  expect(applyChecks(deployment(), checks).health).toBe("healthy");
});

it("downgrades a healthy deployment when a probe fails", async () => {
  const checks = await checkDeployment(deployment(), {
    fetchImpl: async (url) =>
      new Response("error", { status: String(url).includes("api") ? 500 : 200 }),
  });

  const checked = applyChecks(deployment(), checks);
  expect(checked.health).toBe("degraded");
  expect(checked.reasons[0]).toContain("api URL");
  expect(checked.reasons[0]).toContain("HTTP 500");
});

it("records network errors as unreachable checks", async () => {
  const checks = await checkDeployment(deployment(), {
    fetchImpl: async () => {
      const error = new Error("connection refused");
      throw error;
    },
  });

  expect(checks.every((check) => !check.reachable)).toBe(true);
  expect(checks[0]?.error).toBe("connection refused");
});

it("does not probe missing URLs", async () => {
  let calls = 0;
  const checks = await checkDeployment(
    { ...deployment(), adminUrl: undefined, apiUrl: undefined },
    {
      fetchImpl: async () => {
        calls += 1;
        return new Response("ok");
      },
    },
  );

  expect(checks).toEqual([]);
  expect(calls).toBe(0);
});
