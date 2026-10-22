#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

interface SarifPhysicalLocation {
  artifactLocation?: { uri?: string };
  region?: { startLine?: number };
}

export interface SarifResult {
  ruleId?: string;
  level?: string;
  message?: { text?: string };
  locations?: Array<{ physicalLocation?: SarifPhysicalLocation }>;
  properties?: Record<string, unknown>;
}

export interface SarifRule {
  id?: string;
  properties?: Record<string, unknown>;
}

export interface SarifRun {
  tool?: { driver?: { rules?: SarifRule[] } };
  results?: SarifResult[];
}

export interface SarifLog {
  runs?: SarifRun[];
}

export interface SarifFinding {
  /** Rule that produced the finding. */
  ruleId: string;
  /** SARIF severity, defaulting to `warning` when the report omits it. */
  level: string;
  /** CVSS-based security severity from CodeQL, when the result has one. */
  securitySeverity: number | null;
  /** Human-readable finding description. */
  message: string;
  /** File and line where the finding was reported. */
  location: string;
}

/**
 * Collect every reported result. SARIF defaults a missing level to `warning`.
 */
export function collectFindings(logs: SarifLog[]): SarifFinding[] {
  const findings: SarifFinding[] = [];

  for (const log of logs) {
    for (const run of log.runs ?? []) {
      const ruleSeverities = new Map<string, number>();
      for (const rule of run.tool?.driver?.rules ?? []) {
        const severity = readSecuritySeverity(rule);
        if (rule.id !== undefined && severity !== null) ruleSeverities.set(rule.id, severity);
      }
      for (const result of run.results ?? []) {
        const physicalLocation = result.locations?.[0]?.physicalLocation;
        const uri = physicalLocation?.artifactLocation?.uri ?? "unknown location";
        const line = physicalLocation?.region?.startLine;
        findings.push({
          ruleId: result.ruleId ?? "unknown-rule",
          level: result.level ?? "warning",
          securitySeverity:
            readSecuritySeverity(result) ??
            (result.ruleId === undefined ? null : (ruleSeverities.get(result.ruleId) ?? null)),
          message: result.message?.text ?? "No message",
          location: line === undefined ? uri : `${uri}:${line}`,
        });
      }
    }
  }

  return findings;
}

function readSecuritySeverity(item: { properties?: Record<string, unknown> }): number | null {
  const raw = item.properties?.["security-severity"];
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isFinite(value) ? value : null;
}

/**
 * A result blocks when CodeQL marks it as an error or when its CVSS-based
 * security severity is high or critical (7.0 or above).
 */
export function isBlockingFinding(finding: SarifFinding): boolean {
  return finding.level === "error" || (finding.securitySeverity ?? 0) >= 7;
}

/** Collect results that should fail the static analysis job. */
export function collectBlockingFindings(logs: SarifLog[]): SarifFinding[] {
  return collectFindings(logs).filter(isBlockingFinding);
}

function sarifFilesIn(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    if (entry.isDirectory()) return sarifFilesIn(child);
    return entry.name.endsWith(".sarif") ? [child] : [];
  });
}

/** Read every SARIF file under the given files and directories. */
export function loadSarifLogs(paths: string[]): SarifLog[] {
  return paths.flatMap((path) =>
    sarifFilesIn(path).map((file) => JSON.parse(readFileSync(file, "utf8")) as SarifLog),
  );
}

function main(): void {
  const target = process.argv[2] ?? "codeql-results";
  let files: string[];
  let logs: SarifLog[];
  try {
    files = sarifFilesIn(target);
    logs = loadSarifLogs([target]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Static analysis gate could not read its SARIF results: ${message}`);
    process.exitCode = 2;
    return;
  }

  if (files.length === 0) {
    console.error(`Static analysis gate found no SARIF files in ${target}.`);
    process.exitCode = 2;
    return;
  }

  const debugRules = logs.flatMap(
    (log) => log.runs?.flatMap((run) => run.tool?.driver?.rules ?? []) ?? [],
  );
  console.log("DEBUG rules:", JSON.stringify(debugRules.slice(0, 2), null, 2));
  const findings = collectFindings(logs);
  const blocking = findings.filter(isBlockingFinding);
  const lowerSeverity = findings.length - blocking.length;

  if (blocking.length === 0) {
    const suffix =
      lowerSeverity === 0 ? "" : `; ignored ${lowerSeverity} lower-severity finding(s)`;
    console.log(
      `Static analysis passed: no error-level findings in ${files.length} SARIF file(s)${suffix}.`,
    );
    if (lowerSeverity > 0) {
      console.warn("Lower-severity findings (not blocking):");
      for (const finding of findings) {
        if (isBlockingFinding(finding)) continue;
        const severity =
          finding.securitySeverity === null ? "" : ` (severity ${finding.securitySeverity})`;
        console.warn(
          `  ${finding.level.padEnd(7)} ${finding.ruleId}${severity} at ${finding.location}`,
        );
      }
    }
    return;
  }

  console.error("Static analysis found error-level findings:");
  for (const finding of blocking) {
    console.error(`  ${finding.ruleId} at ${finding.location}`);
    console.error(`    ${finding.message}`);
  }
  console.error("Fix the findings and re-run the analysis.");
  process.exitCode = 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
