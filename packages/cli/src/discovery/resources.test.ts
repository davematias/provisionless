import { expect, it } from "vitest";

import { groupDeployments, parseTaggedResource } from "./resources.ts";
import type { TaggedResource } from "./types.ts";

const TAGS = { "provisionless:managed": "true", "provisionless:app": "demo" };

function tagged(arn: string, region: string, tags = TAGS): TaggedResource {
  return { arn, region, tags };
}

it("parses resource kinds and names from ARNs", () => {
  expect(
    parseTaggedResource(
      tagged("arn:aws:lambda:eu-west-1:111122223333:function:demo-api", "eu-west-1"),
    ),
  ).toMatchObject({ service: "lambda", kind: "function", name: "demo-api" });
  expect(
    parseTaggedResource(
      tagged("arn:aws:dynamodb:eu-west-1:111122223333:table/demo-users", "eu-west-1"),
    ),
  ).toMatchObject({ service: "dynamodb", kind: "table", name: "demo-users" });
  expect(parseTaggedResource(tagged("arn:aws:s3:::demo-media", "us-east-1"))).toMatchObject({
    service: "s3",
    kind: "bucket",
    name: "demo-media",
    region: "us-east-1",
  });
  expect(
    parseTaggedResource(tagged("arn:aws:iam::111122223333:role/demo-api-role", "us-east-1")),
  ).toMatchObject({ service: "iam", kind: "role", name: "demo-api-role" });
  expect(
    parseTaggedResource(tagged("arn:aws:cloudfront::111122223333:distribution/DIST1", "us-east-1")),
  ).toMatchObject({ service: "cloudfront", kind: "distribution", name: "DIST1" });
  expect(
    parseTaggedResource(
      tagged("arn:aws:apigateway:eu-west-1::/apis/api1/stages/$default", "eu-west-1"),
    ),
  ).toMatchObject({ service: "apigateway", kind: "stage", name: "$default" });
  expect(
    parseTaggedResource(
      tagged("arn:aws:ses:eu-west-1:111122223333:identity/no-reply@example.com", "eu-west-1"),
    ),
  ).toMatchObject({ service: "ses", kind: "identity", name: "no-reply@example.com" });
});

it("groups resources by prefix and attaches global resources", () => {
  const resources = [
    tagged("arn:aws:lambda:eu-west-1:111122223333:function:demo-api", "eu-west-1"),
    tagged("arn:aws:dynamodb:eu-west-1:111122223333:table/demo-users", "eu-west-1"),
    tagged("arn:aws:sqs:eu-west-1:111122223333:demo-admin-revalidation.fifo", "eu-west-1"),
    tagged("arn:aws:apigateway:eu-west-1::/apis/api1", "eu-west-1"),
    tagged("arn:aws:s3:::demo-media", "us-east-1"),
    tagged("arn:aws:iam::111122223333:role/demo-api-role", "us-east-1"),
    tagged("arn:aws:cloudfront::111122223333:distribution/DIST1", "us-east-1"),
    tagged("arn:aws:acm:us-east-1:111122223333:certificate/abc", "us-east-1"),
    tagged("arn:aws:ses:eu-west-1:111122223333:identity/no-reply@example.com", "eu-west-1"),
    tagged("arn:aws:lambda:eu-west-1:111122223333:function:other-api", "eu-west-1", {
      "provisionless:managed": "true",
      "provisionless:app": "other",
    }),
  ];

  const deployments = groupDeployments(resources);

  expect(deployments.map((deployment) => deployment.prefix)).toEqual(["demo", "other"]);
  const demo = deployments[0];
  expect(demo?.region).toBe("eu-west-1");
  expect(demo?.resources.map((resource) => resource.arn)).toContain(
    "arn:aws:cloudfront::111122223333:distribution/DIST1",
  );
  expect(demo?.regions).toEqual(["eu-west-1", "us-east-1"]);
  expect(demo?.resources).toHaveLength(9);
});

it("creates one deployment per anchor region when a prefix spans regions", () => {
  const resources = [
    tagged("arn:aws:lambda:eu-west-1:111122223333:function:demo-api", "eu-west-1"),
    tagged("arn:aws:lambda:us-east-1:111122223333:function:demo-api", "us-east-1"),
    tagged("arn:aws:cloudfront::111122223333:distribution/DIST1", "us-east-1"),
  ];

  const deployments = groupDeployments(resources);

  expect(deployments.map((deployment) => deployment.region)).toEqual(["eu-west-1", "us-east-1"]);
  expect(deployments[0]?.resources).toHaveLength(2);
  expect(deployments[1]?.resources).toHaveLength(1);
});

it("ignores resources without an app tag", () => {
  expect(
    groupDeployments([
      tagged("arn:aws:s3:::unrelated", "us-east-1", { "provisionless:managed": "true" }),
    ]),
  ).toEqual([]);
});

it("ignores a prefix that only has global resources", () => {
  expect(
    groupDeployments([
      tagged("arn:aws:s3:::demo-media", "us-east-1"),
      tagged("arn:aws:cloudfront::111122223333:distribution/DIST1", "us-east-1"),
    ]),
  ).toEqual([]);
});
