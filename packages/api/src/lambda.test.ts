import type { LambdaEvent } from "hono/aws-lambda";
import { expect, it } from "vitest";

import { handler } from "./lambda.ts";

it("serves the health example route through the Lambda handler", async () => {
  const event = {
    version: "2.0",
    routeKey: "GET /health",
    rawPath: "/health",
    rawQueryString: "",
    headers: {},
    body: null,
    isBase64Encoded: false,
    requestContext: {
      http: { method: "GET", path: "/health" },
    },
  } as LambdaEvent;

  const result = await handler(event);

  expect(result.statusCode).toBe(200);
  expect(JSON.parse(result.body)).toEqual({ status: "ok" });
});
