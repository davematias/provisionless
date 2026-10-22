import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { SarifLog, SarifResult } from "./security-sarif.ts";
import { collectBlockingFindings, collectFindings, loadSarifLogs } from "./security-sarif.ts";

function result(level: string | undefined, ruleId = "js/example", line = 12): SarifResult {
  return {
    ruleId,
    ...(level === undefined ? {} : { level }),
    message: { text: `Finding from ${ruleId}` },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: "packages/api/src/app.ts" },
          region: { startLine: line },
        },
      },
    ],
  };
}

describe("collectBlockingFindings", () => {
  it("collects only error-level results with their location", () => {
    const logs: SarifLog[] = [
      {
        runs: [
          {
            results: [
              result("error", "js/code-injection", 7),
              result("warning", "js/unused-variable", 3),
              result("note", "js/info"),
              result(undefined, "js/default-warning"),
            ],
          },
        ],
      },
    ];

    expect(collectBlockingFindings(logs)).toEqual([
      {
        ruleId: "js/code-injection",
        level: "error",
        message: "Finding from js/code-injection",
        location: "packages/api/src/app.ts:7",
      },
    ]);
  });

  it("aggregates results across runs and logs", () => {
    const logs: SarifLog[] = [
      { runs: [{ results: [result("error", "js/a")] }] },
      {
        runs: [{ results: [result("error", "js/b", 40)] }, { results: [result("error", "js/c")] }],
      },
    ];

    expect(collectBlockingFindings(logs).map((finding) => finding.ruleId)).toEqual([
      "js/a",
      "js/b",
      "js/c",
    ]);
  });

  it("tolerates results without a location or message", () => {
    const logs: SarifLog[] = [{ runs: [{ results: [{ level: "error" }] }] }];

    expect(collectBlockingFindings(logs)).toEqual([
      {
        ruleId: "unknown-rule",
        level: "error",
        message: "No message",
        location: "unknown location",
      },
    ]);
  });

  it("returns nothing for a clean report", () => {
    expect(collectBlockingFindings([{ runs: [{ results: [] }] }])).toEqual([]);
  });
});

describe("collectFindings", () => {
  it("includes lower severities and defaults a missing level to warning", () => {
    const logs: SarifLog[] = [
      { runs: [{ results: [result("error"), result(undefined), result("note")] }] },
    ];

    expect(collectFindings(logs).map((finding) => finding.level)).toEqual([
      "error",
      "warning",
      "note",
    ]);
  });
});

describe("loadSarifLogs", () => {
  it("reads SARIF files from nested directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "sarif-"));
    mkdirSync(join(dir, "javascript"));
    writeFileSync(join(dir, "javascript", "report.sarif"), JSON.stringify({ runs: [] }));
    writeFileSync(join(dir, "javascript", "notes.txt"), "ignored");

    expect(loadSarifLogs([dir])).toEqual([{ runs: [] }]);
  });
});
