import type { Deployment } from "./types.ts";

function value(value: string | undefined): string {
  return value ?? "-";
}

/** Formats deployments as a simple aligned table. */
export function formatDeploymentTable(deployments: Deployment[]): string {
  if (deployments.length === 0) {
    return "No Provisionless deployments found.\n";
  }

  const headers = ["PREFIX", "REGION", "HEALTH", "ADMIN", "API"];
  const rows = deployments.map((deployment) => [
    deployment.prefix,
    deployment.region,
    deployment.health,
    value(deployment.adminUrl),
    value(deployment.apiUrl),
  ]);
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const line = (cells: string[]): string =>
    cells
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd();

  return `${[line(headers), ...rows.map(line)].join("\n")}\n`;
}

/** Formats one deployment with resources, URLs, health, and live checks. */
export function formatDeploymentStatus(deployment: Deployment): string {
  const lines = [
    `Deployment ${deployment.prefix} (${deployment.region})`,
    `Health: ${deployment.health}`,
    `Admin URL: ${value(deployment.adminUrl)}`,
    `API URL: ${value(deployment.apiUrl)}`,
    `Regions: ${deployment.regions.join(", ")}`,
  ];

  if (deployment.reasons.length > 0) {
    lines.push("Reasons:");
    for (const reason of deployment.reasons) {
      lines.push(`  - ${reason}`);
    }
  }

  lines.push("Resources:");
  for (const resource of deployment.resources) {
    lines.push(`  ${resource.service.padEnd(11)} ${resource.kind.padEnd(12)} ${resource.name}`);
    lines.push(`  ${"".padEnd(11)} ${"".padEnd(12)} ${resource.arn}`);
  }

  if (deployment.checks && deployment.checks.length > 0) {
    lines.push("Checks:");
    for (const check of deployment.checks) {
      const result = check.reachable
        ? `reachable (HTTP ${check.status ?? "ok"})`
        : `unreachable (${check.error ?? `HTTP ${check.status ?? "unknown"}`})`;
      lines.push(`  ${check.name.padEnd(6)} ${result.padEnd(28)} ${check.url}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

/** JSON shape for `list --json`. */
export function listJson(deployments: Deployment[]): object[] {
  return deployments.map((deployment) => ({
    prefix: deployment.prefix,
    region: deployment.region,
    adminUrl: deployment.adminUrl,
    apiUrl: deployment.apiUrl,
    health: deployment.health,
  }));
}

/** JSON shape for `status --json`. */
export function statusJson(deployment: Deployment): object {
  return deployment;
}
