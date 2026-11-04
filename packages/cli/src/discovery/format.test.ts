import { expect, it } from "vitest";

import { formatDeploymentStatus, formatDeploymentTable, listJson, statusJson } from "./format.ts";
import type { Deployment, DeploymentResource } from "./types.ts";

const RESOURCE: DeploymentResource = {
  arn: "arn:aws:lambda:eu-west-1:111122223333:function:demo-api",
  service: "lambda",
  kind: "function",
  name: "demo-api",
  region: "eu-west-1",
};

function deployment(overrides: Partial<Deployment> = {}): Deployment {
  return {
    prefix: "demo",
    region: "eu-west-1",
    adminUrl: "https://admin.example.com",
    apiUrl: "https://api.example.com",
    health: "healthy",
    reasons: [],
    resources: [RESOURCE],
    regions: ["eu-west-1"],
    ...overrides,
  };
}

it("renders a deployment table", () => {
  const table = formatDeploymentTable([deployment()]);

  expect(table).toContain("PREFIX");
  expect(table).toContain("demo");
  expect(table).toContain("eu-west-1");
  expect(table).toContain("healthy");
  expect(table).toContain("https://admin.example.com");
  expect(table).toContain("https://api.example.com");
});

it("reports an empty deployment list", () => {
  expect(formatDeploymentTable([])).toBe("No Provisionless deployments found.\n");
});

it("renders deployment details with reasons, resources, and checks", () => {
  const status = formatDeploymentStatus(
    deployment({
      health: "degraded",
      reasons: ["API Gateway default stage is missing"],
      checks: [
        {
          name: "api",
          url: "https://api.example.com/openapi.json",
          reachable: false,
          status: 500,
        },
      ],
    }),
  );

  expect(status).toContain("Deployment demo (eu-west-1)");
  expect(status).toContain("Health: degraded");
  expect(status).toContain("API Gateway default stage is missing");
  expect(status).toContain("arn:aws:lambda");
  expect(status).toContain("unreachable (HTTP 500)");
});

it("builds the list JSON summary", () => {
  expect(listJson([deployment()])).toEqual([
    {
      prefix: "demo",
      region: "eu-west-1",
      adminUrl: "https://admin.example.com",
      apiUrl: "https://api.example.com",
      health: "healthy",
    },
  ]);
});

it("returns the full deployment for status JSON", () => {
  expect(statusJson(deployment())).toEqual(deployment());
});
