import {
  GetApiCommand,
  GetApiMappingsCommand,
  GetDomainNamesCommand,
  GetStagesCommand,
} from "@aws-sdk/client-apigatewayv2";
import { GetDistributionCommand } from "@aws-sdk/client-cloudfront";
import { expect, it } from "vitest";

import type { Deployment, DeploymentResource } from "./types.ts";
import { hydrateDeployment, hydrateDeployments } from "./urls.ts";

function createDeployment(resources: DeploymentResource[]): Deployment {
  return {
    prefix: "demo",
    region: "eu-west-1",
    health: "unknown",
    reasons: [],
    resources,
    regions: ["eu-west-1"],
  };
}

function resource(
  service: string,
  kind: string,
  name: string,
  region = "eu-west-1",
): DeploymentResource {
  return { arn: `arn:aws:${service}:${region}::${name}`, service, kind, name, region };
}

function cloudFront(status: string, aliases: string[] = []) {
  return {
    send: async (command: unknown) => {
      expect(command).toBeInstanceOf(GetDistributionCommand);
      return {
        Distribution: {
          DomainName: "d111.cloudfront.net",
          Status: status,
          DistributionConfig: {
            Enabled: true,
            Aliases: aliases.length > 0 ? { Quantity: aliases.length, Items: aliases } : undefined,
          },
        },
      };
    },
  };
}

function apiGateway(options: { domain?: string; stage?: boolean; endpoint?: string }) {
  return {
    send: async (command: unknown) => {
      if (command instanceof GetApiCommand) {
        return {
          ApiId: command.input.ApiId,
          ApiEndpoint: options.endpoint ?? "https://api1.execute-api.eu-west-1.amazonaws.com",
        };
      }
      if (command instanceof GetStagesCommand) {
        return { Items: options.stage === false ? [] : [{ StageName: "$default" }] };
      }
      if (command instanceof GetDomainNamesCommand) {
        return { Items: options.domain ? [{ DomainName: options.domain }] : [] };
      }
      if (command instanceof GetApiMappingsCommand) {
        return {
          Items:
            options.domain && command.input.DomainName === options.domain
              ? [{ ApiId: "api1", Stage: "$default" }]
              : [],
        };
      }
      throw new Error("unexpected command");
    },
  };
}

it("derives the admin URL from the distribution alias and the API from its custom domain", async () => {
  const deployment = createDeployment([
    resource("cloudfront", "distribution", "DIST1", "us-east-1"),
    resource("apigateway", "api", "api1"),
  ]);

  const hydrated = await hydrateDeployment(deployment, {
    cloudfront: cloudFront("Deployed", ["admin.example.com"]),
    apiGateway: () => apiGateway({ domain: "api.example.com" }),
  });

  expect(hydrated.adminUrl).toBe("https://admin.example.com");
  expect(hydrated.apiUrl).toBe("https://api.example.com");
  expect(hydrated.health).toBe("healthy");
  expect(hydrated.reasons).toEqual([]);
});

it("falls back to the CloudFront and execute-api domains", async () => {
  const deployment = createDeployment([
    resource("cloudfront", "distribution", "DIST1", "us-east-1"),
    resource("apigateway", "api", "api1"),
  ]);

  const hydrated = await hydrateDeployment(deployment, {
    cloudfront: cloudFront("Deployed"),
    apiGateway: () => apiGateway({ endpoint: "https://api1.execute-api.eu-west-1.amazonaws.com" }),
  });

  expect(hydrated.adminUrl).toBe("https://d111.cloudfront.net");
  expect(hydrated.apiUrl).toBe("https://api1.execute-api.eu-west-1.amazonaws.com");
  expect(hydrated.health).toBe("healthy");
});

it("reports a deploying CloudFront distribution", async () => {
  const deployment = createDeployment([
    resource("cloudfront", "distribution", "DIST1", "us-east-1"),
    resource("apigateway", "api", "api1"),
  ]);

  const hydrated = await hydrateDeployment(deployment, {
    cloudfront: cloudFront("InProgress"),
    apiGateway: () => apiGateway({ endpoint: "https://api1.execute-api.eu-west-1.amazonaws.com" }),
  });

  expect(hydrated.health).toBe("deploying");
  expect(hydrated.reasons).toContain("CloudFront distribution is still deploying");
});

it("reports a missing API default stage as degraded", async () => {
  const deployment = createDeployment([
    resource("cloudfront", "distribution", "DIST1", "us-east-1"),
    resource("apigateway", "api", "api1"),
  ]);

  const hydrated = await hydrateDeployment(deployment, {
    cloudfront: cloudFront("Deployed"),
    apiGateway: () =>
      apiGateway({ stage: false, endpoint: "https://api1.execute-api.eu-west-1.amazonaws.com" }),
  });

  expect(hydrated.health).toBe("degraded");
  expect(hydrated.reasons).toContain("API Gateway default stage is missing");
});

it("reports a missing distribution as degraded without failing", async () => {
  const deployment = createDeployment([
    resource("cloudfront", "distribution", "DIST1", "us-east-1"),
    resource("apigateway", "api", "api1"),
  ]);

  const hydrated = await hydrateDeployment(deployment, {
    cloudfront: {
      send: async () => {
        const error = new Error("missing");
        error.name = "NoSuchDistribution";
        throw error;
      },
    },
    apiGateway: () => apiGateway({ endpoint: "https://api1.execute-api.eu-west-1.amazonaws.com" }),
  });

  expect(hydrated.health).toBe("degraded");
  expect(hydrated.reasons).toContain("CloudFront distribution DIST1 was not found");
});

it("is unknown when no admin or API resources are tagged", async () => {
  const hydrated = await hydrateDeployment(createDeployment([]), {
    cloudfront: cloudFront("Deployed"),
    apiGateway: () => apiGateway({}),
  });

  expect(hydrated.health).toBe("unknown");
  expect(hydrated.adminUrl).toBeUndefined();
  expect(hydrated.apiUrl).toBeUndefined();
});

it("caches custom domain lookups across deployments in one region", async () => {
  let domainCalls = 0;
  const base = apiGateway({ domain: "api.example.com" });
  const client = {
    send: async (command: unknown) => {
      if (command instanceof GetDomainNamesCommand) {
        domainCalls += 1;
      }
      return base.send(command);
    },
  };
  const deployments = [
    createDeployment([
      resource("cloudfront", "distribution", "DIST1", "us-east-1"),
      resource("apigateway", "api", "api1"),
    ]),
    createDeployment([
      resource("cloudfront", "distribution", "DIST2", "us-east-1"),
      resource("apigateway", "api", "api1"),
    ]),
  ];

  await hydrateDeployments(deployments, {
    cloudfront: cloudFront("Deployed"),
    apiGateway: () => client,
  });

  expect(domainCalls).toBe(1);
});
