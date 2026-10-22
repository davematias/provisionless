#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const allowlistFile = join(repoRoot, "scripts", "audit-allowlist.json");

/** Severities that fail the audit. Lower severities are reported as warnings. */
const blockingSeverities = new Set(["high", "critical"]);

/**
 * @typedef {object} Finding
 * @property {string} package Vulnerable package name.
 * @property {string} id Advisory identifier, usually a GHSA id.
 * @property {string} title Advisory title.
 * @property {string} severity Advisory severity.
 * @property {string | null} url Advisory URL.
 */

/**
 * @typedef {object} AuditException
 * @property {string} package Package the exception applies to.
 * @property {string} id Advisory identifier the exception applies to.
 * @property {string} reason Why the advisory is accepted.
 * @property {string} [expires] Last day (YYYY-MM-DD) the exception is valid.
 */

/**
 * Flatten an `npm audit --json` report into one finding per advisory.
 * String entries in `via` reference other vulnerable packages, not advisories.
 * @param {{ vulnerabilities?: Record<string, { via?: Array<object | string> }> }} report
 * @returns {Finding[]}
 */
export function collectFindings(report) {
  const findings = [];
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
 * @param {unknown} allowlist
 * @param {Date} now
 * @returns {{ entries: AuditException[], errors: string[] }}
 */
export function validateAllowlist(allowlist, now = new Date()) {
  if (!Array.isArray(allowlist)) {
    return { entries: [], errors: ["The allowlist must be a JSON array."] };
  }

  const entries = [];
  const errors = [];
  allowlist.forEach((entry, index) => {
    const label = `Allowlist entry ${index + 1}`;
    if (typeof entry?.package !== "string" || entry.package.length === 0) {
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
    entries.push(entry);
  });

  return { entries, errors };
}

/**
 * @param {{ vulnerabilities?: Record<string, { via?: Array<object | string> }> }} report
 * @param {unknown} allowlist
 * @param {{ now?: Date }} [options]
 * @returns {{ blocking: Finding[], warnings: Finding[], allowed: Finding[], errors: string[] }}
 */
export function evaluateAuditReport(report, allowlist, { now = new Date() } = {}) {
  const { entries, errors } = validateAllowlist(allowlist, now);
  const blocking = [];
  const warnings = [];
  const allowed = [];

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

function readAllowlist() {
  return JSON.parse(readFileSync(allowlistFile, "utf8"));
}

function runAudit() {
  try {
    const stdout = execFileSync("npm", ["audit", "--json"], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) {
    // `npm audit` exits non-zero when it finds vulnerabilities; the report is still on stdout.
    if (typeof error.stdout === "string" && error.stdout.trim().length > 0) {
      return JSON.parse(error.stdout);
    }
    throw error;
  }
}

function reportLine({ severity, package: name, id, title }) {
  return `  ${severity.padEnd(9)} ${name}  ${id}  ${title}`;
}

function main() {
  let report;
  try {
    report = runAudit();
  } catch (error) {
    console.error(`Dependency audit could not run: ${error.message}`);
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

  let allowlist;
  try {
    allowlist = readAllowlist();
  } catch (error) {
    console.error(`Dependency audit could not read its allowlist: ${error.message}`);
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
    console.log("Allowed by scripts/audit-allowlist.json:");
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
    "Dependency audit failed. Upgrade the affected package or add a reviewed exception to scripts/audit-allowlist.json.",
  );
  process.exitCode = 1;
}

main();
