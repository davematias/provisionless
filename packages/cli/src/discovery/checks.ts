import type { Deployment, HealthCheck } from "./types.ts";

export interface CheckOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

async function probe(
  name: HealthCheck["name"],
  url: string,
  options: Required<CheckOptions>,
): Promise<HealthCheck> {
  try {
    const response = await options.fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    return { name, url, reachable: response.ok, status: response.status };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? `timed out after ${options.timeoutMs} ms`
        : error instanceof Error
          ? error.message
          : String(error);
    return { name, url, reachable: false, error: message };
  }
}

/** Probes the deployment's admin page and API OpenAPI document. */
export async function checkDeployment(
  deployment: Deployment,
  options: CheckOptions = {},
): Promise<HealthCheck[]> {
  const resolved: Required<CheckOptions> = {
    fetchImpl: options.fetchImpl ?? fetch,
    timeoutMs: options.timeoutMs ?? 5000,
  };
  const checks: HealthCheck[] = [];
  if (deployment.adminUrl) {
    checks.push(await probe("admin", deployment.adminUrl, resolved));
  }
  if (deployment.apiUrl) {
    checks.push(await probe("api", `${deployment.apiUrl}/openapi.json`, resolved));
  }
  return checks;
}

/** Adds live check results to a deployment, downgrading a healthy deployment when a probe fails. */
export function applyChecks(deployment: Deployment, checks: HealthCheck[]): Deployment {
  const failed = checks.filter((check) => !check.reachable);
  if (deployment.health === "healthy" && failed.length > 0) {
    return {
      ...deployment,
      checks,
      health: "degraded",
      reasons: [
        ...deployment.reasons,
        ...failed.map(
          (check) =>
            `${check.name} URL ${check.url} is unreachable (${check.error ?? `HTTP ${check.status ?? "unknown"}`})`,
        ),
      ],
    };
  }
  return { ...deployment, checks };
}
