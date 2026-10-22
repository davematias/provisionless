#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(packageRoot, "../..");
const allowlistFile = join(packageRoot, "audit-allowlist.json");

/** Severities that fail the audit. Lower severities are reported as warnings. */
const blockingSeverities = new Set(["high", "critical"]);

export interface Finding {
  /** Vulnerable package name. */
  package: string;
  /** Advisory identifier, usually a GHSA id. */
  id: string;
  /** Advisory title. */
  title: string;
  /** Advisory severity. */
  severity: string;
  /** Advisory URL. */
  url: string | null;
}

export interface AuditException {
  /** Package the exception applies to. */
  package: string;
  /** Advisory identifier the exception applies to. */
  id: string;
  /** Why the advisory is accepted. */
  reason: string;
  /** Last day (YYYY-MM-DD) the exception is valid. */
  expires?: string;
}

interface AuditAdvisory {
  source?: number;
  url?: string;
  title?: string;
  severity?: string;
}

interface AuditVulnerability {
  via?: Array<AuditAdvisory | string>;
}

export interface AuditReport {
  error?: { summary?: string };
  vulnerabilities?: Record<string, AuditVulnerability>;
}

interface Evaluation {
  /** High and critical advisories without a reviewed exception. */
  blocking: Finding[];
  /** Moderate and low advisories without a reviewed exception. */
  warnings: Finding[];
  /** Advisories suppressed by the allowlist. */
  allowed: Finding[];
  /** Invalid, unexplained, or expired allowlist entries. */
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Flatten an `npm audit --json` report into one finding per advisory.
 * String entries in `via` reference other vulnerable packages, not advisories.
 */
export function collectFindings(report: AuditReport): Finding[] {
  const findings: Finding[] = [];
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
    for (const advisory of vulnerability.via ?? []) {
      if (typeof advisory === "string") continue;
      findings.push({
        package: name,
        id: advisory.url?.split("/").pop() ?? `npm-${advisory.source}`,
        title: advisory.title ?? "Unknown advisory",
        severity: advisory.severity ?? "unknown",
        url: advisory.url ?? null,
      });
    }
  }
  return findings;
}

/**
 * Drop invalid or expired exceptions and explain why, so the allowlist cannot
 * silently rot or be used without a reviewed reason.
 */
export function validateAllowlist(
  allowlist: unknown,
  now = new Date(),
): { entries: AuditException[]; errors: string[] } {
  if (!Array.isArray(allowlist)) {
    return { entries: [], errors: ["The allowlist must be a JSON array."] };
  }

  const entries: AuditException[] = [];
  const errors: string[] = [];
  const candidates: unknown[] = allowlist;
  candidates.forEach((entry, index) => {
    const label = `Allowlist entry ${index + 1}`;
    if (!isRecord(entry)) {
      errors.push(`${label}: must be an object.`);
      return;
    }
    if (typeof entry.package !== "string" || entry.package.length === 0) {
      errors.push(`${label}: "package" must be a non-empty string.`);
      return;
    }
    if (typeof entry.id !== "string" || entry.id.length === 0) {
      errors.push(`${label}: "id" must be a non-empty advisory id.`);
      return;
    }
    if (typeof entry.reason !== "string" || entry.reason.trim().length === 0) {
      errors.push(`${label} (${entry.package} ${entry.id}): "reason" must explain the exception.`);
      return;
    }
    if (entry.expires !== undefined) {
      if (typeof entry.expires !== "string") {
        errors.push(
          `${label} (${entry.package} ${entry.id}): "expires" must be a YYYY-MM-DD date.`,
        );
        return;
      }
      const expires = new Date(`${entry.expires}T23:59:59Z`);
      if (Number.isNaN(expires.getTime())) {
        errors.push(
          `${label} (${entry.package} ${entry.id}): "expires" must be a YYYY-MM-DD date.`,
        );
        return;
      }
      if (expires < now) {
        errors.push(
          `${label} (${entry.package} ${entry.id}) expired on ${entry.expires}; remove it or re-review the advisory.`,
        );
        return;
      }
    }
    entries.push({
      package: entry.package,
      id: entry.id,
      reason: entry.reason,
      ...(entry.expires === undefined ? {} : { expires: entry.expires as string }),
    });
  });

  return { entries, errors };
}

export function evaluateAuditReport(
  report: AuditReport,
  allowlist: unknown,
  { now = new Date() }: { now?: Date } = {},
): Evaluation {
  const { entries, errors } = validateAllowlist(allowlist, now);
  const blocking: Finding[] = [];
  const warnings: Finding[] = [];
  const allowed: Finding[] = [];

  for (const finding of collectFindings(report)) {
    const exception = entries.find(
      (entry) => entry.package === finding.package && entry.id === finding.id,
    );
    if (exception) {
      allowed.push(finding);
    } else if (blockingSeverities.has(finding.severity)) {
      blocking.push(finding);
    } else {
      warnings.push(finding);
    }
  }

  return { blocking, warnings, allowed, errors };
}

function readAllowlist(): unknown {
  return JSON.parse(readFileSync(allowlistFile, "utf8"));
}

function runAudit(): AuditReport {
  try {
    const stdout = execFileSync("npm", ["audit", "--json"], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    return JSON.parse(stdout) as AuditReport;
  } catch (error) {
    // `npm audit` exits non-zero when it finds vulnerabilities; the report is still on stdout.
    const stdout = (error as { stdout?: unknown }).stdout;
    if (typeof stdout === "string" && stdout.trim().length > 0) {
      return JSON.parse(stdout) as AuditReport;
    }
    throw error;
  }
}

function reportLine({ severity, package: name, id, title }: Finding): string {
  return `  ${severity.padEnd(9)} ${name}  ${id}  ${title}`;
}

function main(): void {
  let report: AuditReport;
  try {
    report = runAudit();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Dependency audit could not run: ${message}`);
    process.exitCode = 2;
    return;
  }
  if (report.error) {
    console.error(
      `Dependency audit could not run: ${report.error.summary ?? JSON.stringify(report.error)}`,
    );
    process.exitCode = 2;
    return;
  }

  let allowlist: unknown;
  try {
    allowlist = readAllowlist();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Dependency audit could not read its allowlist: ${message}`);
    process.exitCode = 2;
    return;
  }

  const { blocking, warnings, allowed, errors } = evaluateAuditReport(report, allowlist);

  if (blocking.length > 0) {
    console.error("Blocking vulnerabilities (high or critical):");
    for (const finding of blocking) console.error(reportLine(finding));
  }
  if (warnings.length > 0) {
    console.warn("Non-blocking vulnerabilities (moderate or low):");
    for (const finding of warnings) console.warn(reportLine(finding));
  }
  if (allowed.length > 0) {
    console.log("Allowed by audit-allowlist.json:");
    for (const finding of allowed) console.log(reportLine(finding));
  }
  if (errors.length > 0) {
    console.error("Invalid allowlist entries:");
    for (const error of errors) console.error(`  ${error}`);
  }

  if (blocking.length === 0 && errors.length === 0) {
    console.log("Dependency audit passed: no unallowlisted high or critical vulnerabilities.");
    return;
  }

  console.error(
    "Dependency audit failed. Upgrade the affected package or add a reviewed exception to packages/tooling/audit-allowlist.json.",
  );
  process.exitCode = 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
