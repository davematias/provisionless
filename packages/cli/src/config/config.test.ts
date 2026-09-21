import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { loadConfig, resolveAppPrefix, resolveRegion, saveConfig } from "./config.ts";

function tempRepo(): string {
  return mkdtempSync(join(tmpdir(), "provisionless-config-"));
}

const noop = (): void => undefined;

it("saves and loads the app prefix", () => {
  const repo = tempRepo();
  saveConfig(repo, { appPrefix: "demo" });

  expect(loadConfig(repo)).toEqual({ appPrefix: "demo" });
});

it("returns undefined when there is no config file", () => {
  expect(loadConfig(tempRepo())).toBeUndefined();
});

it("uses the --prefix flag and persists it", async () => {
  const repo = tempRepo();

  const prefix = await resolveAppPrefix({
    repoRoot: repo,
    prefix: "demo",
    ask: async () => "",
    log: noop,
    persist: true,
  });

  expect(prefix).toBe("demo");
  expect(loadConfig(repo)?.appPrefix).toBe("demo");
});

it("reuses a saved prefix when confirmed", async () => {
  const repo = tempRepo();
  saveConfig(repo, { appPrefix: "saved" });

  const prefix = await resolveAppPrefix({
    repoRoot: repo,
    ask: async () => "y",
    log: noop,
    persist: true,
  });

  expect(prefix).toBe("saved");
});

it("prompts for a new prefix when the saved one is rejected", async () => {
  const repo = tempRepo();
  saveConfig(repo, { appPrefix: "old" });
  const answers = ["n", "fresh"];

  const prefix = await resolveAppPrefix({
    repoRoot: repo,
    ask: async () => answers.shift() ?? "",
    log: noop,
    persist: true,
  });

  expect(prefix).toBe("fresh");
  expect(loadConfig(repo)?.appPrefix).toBe("fresh");
});

it("rejects an invalid prefix", async () => {
  await expect(
    resolveAppPrefix({
      repoRoot: tempRepo(),
      prefix: "Bad_Prefix",
      ask: async () => "",
      log: noop,
      persist: true,
    }),
  ).rejects.toThrow();
});

it("uses the --region flag and persists it", async () => {
  const repo = tempRepo();

  const region = await resolveRegion({
    repoRoot: repo,
    region: "eu-west-1",
    ask: async () => "",
    log: noop,
    persist: true,
  });

  expect(region).toBe("eu-west-1");
  expect(loadConfig(repo)?.region).toBe("eu-west-1");
});

it("uses the saved region without prompting", async () => {
  const repo = tempRepo();
  saveConfig(repo, { appPrefix: "demo", region: "ap-southeast-2" });
  let promptCount = 0;

  const region = await resolveRegion({
    repoRoot: repo,
    ask: async () => {
      promptCount += 1;
      return "";
    },
    log: noop,
    persist: true,
  });

  expect(region).toBe("ap-southeast-2");
  expect(promptCount).toBe(0);
});

it("prompts for a region and defaults to us-east-1", async () => {
  const previous = process.env.AWS_REGION;
  delete process.env.AWS_REGION;

  try {
    const region = await resolveRegion({
      repoRoot: tempRepo(),
      ask: async () => "",
      log: noop,
      persist: true,
    });
    expect(region).toBe("us-east-1");
  } finally {
    if (previous !== undefined) {
      process.env.AWS_REGION = previous;
    }
  }
});

it("does not persist during a dry run", async () => {
  const repo = tempRepo();

  const prefix = await resolveAppPrefix({
    repoRoot: repo,
    prefix: "demo",
    ask: async () => "",
    log: noop,
    persist: false,
  });

  expect(prefix).toBe("demo");
  expect(loadConfig(repo)).toBeUndefined();
});
