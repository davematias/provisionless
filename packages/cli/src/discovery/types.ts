/** Health of a discovered deployment. */
export type DeploymentHealth = "healthy" | "deploying" | "degraded" | "unknown";

/** A resource returned by the Resource Groups Tagging API. */
export interface TaggedResource {
  arn: string;
  /** Region whose tagging API returned the resource (the ARN region for regional services). */
  region: string;
  tags: Record<string, string>;
}

/** A parsed resource that belongs to a deployment. */
export interface DeploymentResource {
  arn: string;
  service: string;
  kind: string;
  name: string;
  region: string;
}

/** Result of a live HTTP check against a deployment URL. */
export interface HealthCheck {
  name: "admin" | "api";
  url: string;
  reachable: boolean;
  status?: number;
  error?: string;
}

/** A Provisionless deployment assembled from tagged resources. */
export interface Deployment {
  prefix: string;
  region: string;
  adminUrl?: string;
  apiUrl?: string;
  health: DeploymentHealth;
  reasons: string[];
  resources: DeploymentResource[];
  regions: string[];
  checks?: HealthCheck[];
}
