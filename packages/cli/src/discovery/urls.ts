import {
  GetApiCommand,
  GetApiMappingsCommand,
  GetDomainNamesCommand,
  GetStagesCommand,
  type ApiGatewayV2Client,
} from "@aws-sdk/client-apigatewayv2";
import { GetDistributionCommand, type CloudFrontClient } from "@aws-sdk/client-cloudfront";

import { isAwsError } from "../util/aws.ts";
import type { Deployment, DeploymentHealth } from "./types.ts";

export interface UrlDependencies {
  cloudfront: Pick<CloudFrontClient, "send">;
  apiGateway: (region: string) => Pick<ApiGatewayV2Client, "send">;
}

type DomainCache = Map<string, Map<string, string>>;

async function customDomainUrl(
  region: string,
  apiId: string,
  dependencies: UrlDependencies,
  cache: DomainCache,
): Promise<string | undefined> {
  let cached = cache.get(region);
  if (!cached) {
    cached = new Map<string, string>();
    const client = dependencies.apiGateway(region);
    const domains = await client.send(new GetDomainNamesCommand({}));
    for (const domain of domains.Items ?? []) {
      if (!domain.DomainName) {
        continue;
      }
      const mappings = await client.send(
        new GetApiMappingsCommand({ DomainName: domain.DomainName }),
      );
      const mapping = mappings.Items?.find(
        (item) => item.ApiId === apiId && item.Stage === "$default",
      );
      if (mapping) {
        cached.set(apiId, `https://${domain.DomainName}`);
      }
    }
    cache.set(region, cached);
  }
  return cached.get(apiId);
}

function combineHealth(
  issues: string[],
  deploying: boolean,
  anchors: number,
): { health: DeploymentHealth; reasons: string[] } {
  if (anchors === 0) {
    return { health: "unknown", reasons: ["no tagged admin distribution or API found"] };
  }
  if (deploying) {
    return { health: "deploying", reasons: issues };
  }
  if (issues.length > 0) {
    return { health: "degraded", reasons: issues };
  }
  return { health: "healthy", reasons: [] };
}

/** Resolves the admin and API URLs and control-plane health for one deployment. */
export async function hydrateDeployment(
  deployment: Deployment,
  dependencies: UrlDependencies,
  cache: DomainCache = new Map(),
): Promise<Deployment> {
  const issues: string[] = [];
  let deploying = false;
  let anchors = 0;
  let adminUrl: string | undefined;
  let apiUrl: string | undefined;

  const distribution = deployment.resources.find(
    (resource) => resource.service === "cloudfront" && resource.kind === "distribution",
  );
  if (distribution) {
    anchors += 1;
    try {
      const result = await dependencies.cloudfront.send(
        new GetDistributionCommand({ Id: distribution.name }),
      );
      const detail = result.Distribution;
      if (!detail?.DomainName) {
        issues.push(`CloudFront distribution ${distribution.name} has no domain name`);
      } else {
        const alias = detail.DistributionConfig?.Aliases?.Items?.[0];
        adminUrl = `https://${alias ?? detail.DomainName}`;
        if (detail.Status === "InProgress") {
          deploying = true;
          issues.push("CloudFront distribution is still deploying");
        } else if (detail.Status !== "Deployed") {
          issues.push(`CloudFront distribution is ${detail.Status ?? "in an unknown state"}`);
        }
      }
    } catch (error) {
      if (isAwsError(error, "NoSuchDistribution")) {
        issues.push(`CloudFront distribution ${distribution.name} was not found`);
      } else {
        throw error;
      }
    }
  } else {
    issues.push("no tagged CloudFront distribution");
  }

  const api = deployment.resources.find(
    (resource) => resource.service === "apigateway" && resource.kind === "api",
  );
  if (api) {
    anchors += 1;
    const client = dependencies.apiGateway(deployment.region);
    try {
      const detail = await client.send(new GetApiCommand({ ApiId: api.name }));
      if (!detail.ApiEndpoint) {
        issues.push(`API Gateway API ${api.name} has no endpoint`);
      } else {
        apiUrl =
          (await customDomainUrl(deployment.region, api.name, dependencies, cache)) ??
          detail.ApiEndpoint;
      }
      const stages = await client.send(new GetStagesCommand({ ApiId: api.name }));
      if (!stages.Items?.some((stage) => stage.StageName === "$default")) {
        issues.push("API Gateway default stage is missing");
      }
    } catch (error) {
      if (isAwsError(error, "NotFoundException")) {
        issues.push(`API Gateway API ${api.name} was not found`);
      } else {
        throw error;
      }
    }
  } else {
    issues.push("no tagged API Gateway HTTP API");
  }

  const combined = combineHealth(issues, deploying, anchors);
  return {
    ...deployment,
    adminUrl,
    apiUrl,
    health: combined.health,
    reasons: combined.reasons,
  };
}

/** Resolves URLs and control-plane health for every deployment. */
export async function hydrateDeployments(
  deployments: Deployment[],
  dependencies: UrlDependencies,
): Promise<Deployment[]> {
  const cache: DomainCache = new Map();
  const hydrated: Deployment[] = [];
  for (const deployment of deployments) {
    hydrated.push(await hydrateDeployment(deployment, dependencies, cache));
  }
  return hydrated;
}
