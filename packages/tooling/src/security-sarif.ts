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
}

export interface SarifRun {
  results?: SarifResult[];
}

export interface SarifLog {
  runs?: SarifRun[];
}

export interface BlockingFinding {
  /** Rule that produced the finding. */
  ruleId: string;
  /** SARIF severity, always `error` for blocking findings. */
  level: string;
  /** Human-readable finding description. */
  message: string;
  /** File and line where the finding was reported. */
  location: string;
}

/**
 * Collect results that should fail the static analysis job. SARIF defaults a
 * missing level to `warning`, so only explicit `error` results block.
 */
export function collectBlockingFindings(logs: SarifLog[]): BlockingFinding[] {
  const findings: BlockingFinding[] = [];

  for (const log of logs) {
    for (const run of log.runs ?? []) {
      for (const result of run.results ?? []) {
        if (result.level !== "error") continue;
        const physicalLocation = result.locations?.[0]?.physicalLocation;
        const uri = physicalLocation?.artifactLocation?.uri ?? "unknown location";
        const line = physicalLocation?.region?.startLine;
        findings.push({
          ruleId: result.ruleId ?? "unknown-rule",
          level: result.level,
          message: result.message?.text ?? "No message",
          location: line === undefined ? uri : `${uri}:${line}`,
        });
      }
    }
  }

  return findings;
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

  const findings = collectBlockingFindings(logs);
  if (findings.length === 0) {
    console.log(
      `Static analysis passed: no error-level findings in ${files.length} SARIF file(s).`,
    );
    return;
  }

  console.error("Static analysis found error-level findings:");
  for (const finding of findings) {
    console.error(`  ${finding.ruleId} at ${finding.location}`);
    console.error(`    ${finding.message}`);
  }
  console.error(
    "Fix the findings or dismiss them as false positives in GitHub code scanning, then re-run.",
  );
  process.exitCode = 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
