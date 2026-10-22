import { describe, expect, it } from "vitest";
import { collectFindings, evaluateAuditReport } from "./audit-dependencies.mjs";

const now = new Date("2026-10-22T12:00:00Z");

function advisory(id: string, severity: string, title = `Advisory ${id}`) {
  return {
    source: 1,
    url: `https://github.com/advisories/${id}`,
    title,
    severity,
  };
}

function report(vulnerabilities: Record<string, unknown>) {
  return { vulnerabilities };
}

describe("collectFindings", () => {
  it("flattens advisories and ignores package references in via", () => {
    const findings = collectFindings(
      report({
        hono: { via: [advisory("GHSA-1111-1111-1111", "moderate")] },
        next: {
          via: ["hono", advisory("GHSA-2222-2222-2222", "critical", "Remote code execution")],
        },
      }),
    );

    expect(findings).toEqual([
      {
        package: "hono",
        id: "GHSA-1111-1111-1111",
        title: "Advisory GHSA-1111-1111-1111",
        severity: "moderate",
        url: "https://github.com/advisories/GHSA-1111-1111-1111",
      },
      {
        package: "next",
        id: "GHSA-2222-2222-2222",
        title: "Remote code execution",
        severity: "critical",
        url: "https://github.com/advisories/GHSA-2222-2222-2222",
      },
    ]);
  });
});

describe("evaluateAuditReport", () => {
  it("blocks high and critical advisories and only warns on lower severities", () => {
    const result = evaluateAuditReport(
      report({
        vite: { via: [advisory("GHSA-3333-3333-3333", "high")] },
        hono: { via: [advisory("GHSA-4444-4444-4444", "moderate")] },
        next: { via: [advisory("GHSA-5555-5555-5555", "critical")] },
      }),
      [],
      { now },
    );

    expect(result.blocking.map((finding) => finding.id)).toEqual([
      "GHSA-3333-3333-3333",
      "GHSA-5555-5555-5555",
    ]);
    expect(result.warnings.map((finding) => finding.id)).toEqual(["GHSA-4444-4444-4444"]);
    expect(result.errors).toEqual([]);
  });

  it("suppresses a matching allowlist entry", () => {
    const allowlist = [
      {
        package: "source-map-js",
        id: "GHSA-3333-3333-3333",
        reason: "Only reachable from build tooling that never parses untrusted source maps.",
        expires: "2026-12-31",
      },
    ];

    const result = evaluateAuditReport(
      report({ "source-map-js": { via: [advisory("GHSA-3333-3333-3333", "high")] } }),
      allowlist,
      { now },
    );

    expect(result.blocking).toEqual([]);
    expect(result.allowed).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it("still blocks an advisory when the allowlist names another package", () => {
    const allowlist = [
      {
        package: "vite",
        id: "GHSA-3333-3333-3333",
        reason: "Developer-only tooling.",
        expires: "2026-12-31",
      },
    ];

    const result = evaluateAuditReport(
      report({ "source-map-js": { via: [advisory("GHSA-3333-3333-3333", "high")] } }),
      allowlist,
      { now },
    );

    expect(result.blocking).toHaveLength(1);
    expect(result.allowed).toEqual([]);
  });

  it("rejects allowlist entries without a reason or with a bad expiry", () => {
    const result = evaluateAuditReport(
      report({ vite: { via: [advisory("GHSA-3333-3333-3333", "high")] } }),
      [
        { package: "vite", id: "GHSA-3333-3333-3333", reason: "  " },
        {
          package: "vite",
          id: "GHSA-3333-3333-3333",
          reason: "Developer-only tooling.",
          expires: "next week",
        },
        {
          package: "vite",
          id: "GHSA-3333-3333-3333",
          reason: "Developer-only tooling.",
          expires: "2026-10-01",
        },
      ],
      { now },
    );

    expect(result.errors).toHaveLength(3);
    expect(result.blocking).toHaveLength(1);
  });

  it("rejects a non-array allowlist", () => {
    const result = evaluateAuditReport(report({}), { package: "vite" }, { now });

    expect(result.errors).toEqual(["The allowlist must be a JSON array."]);
  });

  it("passes a clean report", () => {
    const result = evaluateAuditReport(report({}), [], { now });

    expect(result).toEqual({ blocking: [], warnings: [], allowed: [], errors: [] });
  });
});
