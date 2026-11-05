import { APP_TAG_KEY } from "../aws/tags.ts";
import type { Deployment, DeploymentResource, TaggedResource } from "./types.ts";

const GLOBAL_SERVICES = new Set(["cloudfront", "iam", "s3"]);

function resourceKind(service: string, resource: string): { kind: string; name: string } {
  switch (service) {
    case "lambda":
      return { kind: "function", name: resource.replace(/^function:/u, "") };
    case "dynamodb":
      return { kind: "table", name: resource.replace(/^table\//u, "") };
    case "sqs":
      return { kind: "queue", name: resource };
    case "s3":
      return { kind: "bucket", name: resource };
    case "iam":
      return { kind: "role", name: resource.replace(/^role\//u, "") };
    case "cloudfront": {
      const [kind = "resource", ...rest] = resource.split("/");
      return { kind, name: rest.join("/") };
    }
    case "apigateway": {
      if (resource.startsWith("/apis/")) {
        const segments = resource.slice("/apis/".length).split("/");
        return segments.length > 1
          ? { kind: "stage", name: segments[segments.length - 1] ?? resource }
          : { kind: "api", name: segments[0] ?? resource };
      }
      if (resource.startsWith("/domainnames/")) {
        return { kind: "domain", name: resource.slice("/domainnames/".length) };
      }
      return { kind: "resource", name: resource };
    }
    case "acm":
      return { kind: "certificate", name: resource.replace(/^certificate\//u, "") };
    case "ses":
      return { kind: "identity", name: resource.replace(/^identity\//u, "") };
    case "logs":
      return { kind: "log-group", name: resource.replace(/^log-group:/u, "") };
    case "sns":
      return { kind: "topic", name: resource };
    case "cloudwatch":
      return { kind: "alarm", name: resource.replace(/^alarm:/u, "") };
    default: {
      const [kind = "resource", ...rest] = resource.split(/[/:]/u);
      return { kind, name: rest.join("/") || resource };
    }
  }
}

/** Parses a tagged resource ARN into a deployment resource. */
export function parseTaggedResource(resource: TaggedResource): DeploymentResource {
  const parts = resource.arn.split(":");
  const service = parts[2] ?? "unknown";
  const arnRegion = parts[3] || resource.region;
  const arnResource = parts.slice(5).join(":");
  const { kind, name } = resourceKind(service, arnResource);
  return { arn: resource.arn, service, kind, name, region: arnRegion };
}

function isGlobal(resource: DeploymentResource): boolean {
  return GLOBAL_SERVICES.has(resource.service);
}

function anchorRegions(resources: DeploymentResource[]): string[] {
  const regions = new Set<string>();
  for (const resource of resources) {
    if (resource.service === "apigateway" && resource.kind === "api") {
      regions.add(resource.region);
    } else if (
      resource.service === "lambda" &&
      resource.kind === "function" &&
      resource.name.endsWith("-api")
    ) {
      regions.add(resource.region);
    } else if (
      resource.service === "dynamodb" &&
      resource.kind === "table" &&
      resource.name.endsWith("-users")
    ) {
      regions.add(resource.region);
    }
  }
  return [...regions].sort();
}

function mostCommonRegion(resources: DeploymentResource[]): string {
  const counts = new Map<string, number>();
  for (const resource of resources) {
    counts.set(resource.region, (counts.get(resource.region) ?? 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [region, count] of counts) {
    if (count > bestCount) {
      best = region;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Groups tagged resources into deployments by `provisionless:app`. A prefix deployed in multiple
 * regions becomes one deployment per region; global resources (CloudFront, IAM, S3) attach to the
 * first deployment because their ARNs do not identify a region.
 */
export function groupDeployments(resources: TaggedResource[]): Deployment[] {
  const byPrefix = new Map<string, DeploymentResource[]>();
  for (const resource of resources) {
    const prefix = resource.tags[APP_TAG_KEY];
    if (!prefix) {
      continue;
    }
    const parsed = parseTaggedResource(resource);
    const list = byPrefix.get(prefix) ?? [];
    list.push(parsed);
    byPrefix.set(prefix, list);
  }

  const deployments: Deployment[] = [];
  for (const [prefix, parsed] of byPrefix) {
    const unique = [...new Map(parsed.map((resource) => [resource.arn, resource])).values()];
    const anchors = anchorRegions(unique);
    const fallback = mostCommonRegion(unique.filter((resource) => !isGlobal(resource)));
    const regions = anchors.length > 0 ? anchors : fallback ? [fallback] : [];
    if (regions.length === 0) {
      continue;
    }

    regions.forEach((region, index) => {
      const included =
        regions.length === 1
          ? unique
          : unique.filter((resource) =>
              isGlobal(resource) ? index === 0 : resource.region === region,
            );
      if (included.length === 0) {
        return;
      }
      deployments.push({
        prefix,
        region,
        health: "unknown",
        reasons: [],
        resources: included.sort(
          (left, right) =>
            left.service.localeCompare(right.service) || left.name.localeCompare(right.name),
        ),
        regions: [...new Set(included.map((resource) => resource.region))].sort(),
      });
    });
  }

  return deployments.sort(
    (left, right) =>
      left.prefix.localeCompare(right.prefix) || left.region.localeCompare(right.region),
  );
}
