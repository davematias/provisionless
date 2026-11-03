import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { unzipSync, zipSync } from "fflate";
import { expect, it } from "vitest";

import { API_URL_PLACEHOLDER, formatChecksums, releaseAssets, sha256 } from "./release.ts";
import { resolveAdminArtifact, resolveApiArtifact, rewriteApiUrl } from "./resolve.ts";

const VERSION = "1.2.3";
const API_URL = "https://api.example.test";
const OTHER_API_URL = "https://other-api.example.test";
const noop = (): void => undefined;

type Files = Record<string, Uint8Array | string>;

interface Served {
  baseUrl: string;
  requests: string[];
  close: () => Promise<void>;
}

function serve(files: Files): Promise<Served> {
  const requests: string[] = [];
  return new Promise((done) => {
    const server = createServer((request, response) => {
      const path = request.url ?? "/";
      requests.push(path);
      const body = files[path];
      if (!body) {
        response.statusCode = 404;
        response.end("not found");
        return;
      }
      response.setHeader("content-type", "application/octet-stream");
      response.end(typeof body === "string" ? Buffer.from(body) : Buffer.from(body));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("The test server did not expose a port.");
      }
      done({
        baseUrl: `http://127.0.0.1:${address.port}/releases/download`,
        requests,
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
      });
    });
  });
}

function artifactFixture(): {
  files: Files;
  assets: ReturnType<typeof releaseAssets>;
  apiArchive: Uint8Array;
  adminPath: string;
} {
  const assets = releaseAssets(VERSION);
  const adminArchive = zipSync({
    "open-next.output.json": new TextEncoder().encode(
      JSON.stringify({ origins: {}, additionalProps: {}, behaviors: [] }),
    ),
    "server-functions/default/index.mjs": new TextEncoder().encode(
      `export const api = "${API_URL_PLACEHOLDER}";`,
    ),
    "assets/app.js": new TextEncoder().encode(`fetch("${API_URL_PLACEHOLDER}/content");`),
    "assets/logo.png": Uint8Array.from([137, 80, 78, 71, 0, 255]),
  });
  const apiArchive = zipSync({
    "index.mjs": new TextEncoder().encode("export const handler = () => {};"),
  });
  const checksums = formatChecksums([
    { name: assets.admin, digest: sha256(adminArchive) },
    { name: assets.api, digest: sha256(apiArchive) },
  ]);
  const directory = `/releases/download/${assets.tag}`;

  return {
    files: {
      [`${directory}/${assets.admin}`]: adminArchive,
      [`${directory}/${assets.api}`]: apiArchive,
      [`${directory}/${assets.checksums}`]: checksums,
    },
    assets,
    apiArchive,
    adminPath: `${directory}/${assets.admin}`,
  };
}

function environment(baseUrl: string): NodeJS.ProcessEnv {
  return {
    PROVISIONLESS_CACHE_DIR: mkdtempSync(join(tmpdir(), "provisionless-artifacts-")),
    PROVISIONLESS_RELEASE_BASE_URL: baseUrl,
  };
}

async function failure(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected the promise to reject.");
}

it("downloads, verifies, and prepares the admin artifact", async () => {
  const fixture = artifactFixture();
  const served = await serve(fixture.files);
  try {
    const env = environment(served.baseUrl);
    const directory = await resolveAdminArtifact({
      version: VERSION,
      apiUrl: API_URL,
      log: noop,
      env,
    });

    const serverCode = readFileSync(
      join(directory, "server-functions", "default", "index.mjs"),
      "utf8",
    );
    expect(serverCode).toContain(`"${API_URL}"`);
    expect(serverCode).not.toContain(API_URL_PLACEHOLDER);
    expect(readFileSync(join(directory, "assets", "app.js"), "utf8")).toContain(
      `${API_URL}/content`,
    );
    expect(readFileSync(join(directory, "assets", "logo.png"))).toEqual(
      Buffer.from([137, 80, 78, 71, 0, 255]),
    );
    expect(JSON.parse(readFileSync(join(directory, "open-next.output.json"), "utf8"))).toEqual({
      origins: {},
      additionalProps: {},
      behaviors: [],
    });
  } finally {
    await served.close();
  }
});

it("reuses cached artifacts without contacting the release", async () => {
  const fixture = artifactFixture();
  const served = await serve(fixture.files);
  try {
    const env = environment(served.baseUrl);
    const directory = await resolveAdminArtifact({
      version: VERSION,
      apiUrl: API_URL,
      log: noop,
      env,
    });
    const requestCount = served.requests.length;

    await expect(
      resolveAdminArtifact({ version: VERSION, apiUrl: API_URL, log: noop, env }),
    ).resolves.toBe(directory);
    expect(served.requests).toHaveLength(requestCount);

    const apiFirst = await resolveApiArtifact({ version: VERSION, log: noop, env });
    const apiCount = served.requests.length;
    const apiSecond = await resolveApiArtifact({ version: VERSION, log: noop, env });

    expect(unzipSync(new Uint8Array(apiFirst))["index.mjs"]).toEqual(
      unzipSync(new Uint8Array(fixture.apiArchive))["index.mjs"],
    );
    expect(apiSecond).toEqual(apiFirst);
    expect(served.requests).toHaveLength(apiCount);
  } finally {
    await served.close();
  }
});

it("prepares a separate cache entry for each API URL", async () => {
  const fixture = artifactFixture();
  const served = await serve(fixture.files);
  try {
    const env = environment(served.baseUrl);
    const first = await resolveAdminArtifact({
      version: VERSION,
      apiUrl: API_URL,
      log: noop,
      env,
    });
    const second = await resolveAdminArtifact({
      version: VERSION,
      apiUrl: OTHER_API_URL,
      log: noop,
      env,
    });

    expect(second).not.toBe(first);
    expect(readFileSync(join(first, "server-functions", "default", "index.mjs"), "utf8")).toContain(
      API_URL,
    );
    expect(
      readFileSync(join(second, "server-functions", "default", "index.mjs"), "utf8"),
    ).toContain(OTHER_API_URL);
  } finally {
    await served.close();
  }
});

it("names the expected version and asset when a release asset is missing", async () => {
  const fixture = artifactFixture();
  delete fixture.files[fixture.adminPath];
  const served = await serve(fixture.files);
  try {
    const error = await failure(
      resolveAdminArtifact({
        version: VERSION,
        apiUrl: API_URL,
        log: noop,
        env: environment(served.baseUrl),
      }),
    );

    expect(error.message).toContain(fixture.assets.admin);
    expect(error.message).toContain(`Provisionless ${VERSION}`);
    expect(error.message).toContain(fixture.assets.tag);
    expect(error.message).toContain("HTTP 404");
  } finally {
    await served.close();
  }
});

it("names the checksums asset when it is missing", async () => {
  const fixture = artifactFixture();
  const checksumsPath = `/releases/download/${fixture.assets.tag}/${fixture.assets.checksums}`;
  delete fixture.files[checksumsPath];
  const served = await serve(fixture.files);
  try {
    const error = await failure(
      resolveAdminArtifact({
        version: VERSION,
        apiUrl: API_URL,
        log: noop,
        env: environment(served.baseUrl),
      }),
    );

    expect(error.message).toContain(fixture.assets.checksums);
    expect(error.message).toContain(`Provisionless ${VERSION}`);
  } finally {
    await served.close();
  }
});

it("reports an asset missing from the checksum list", async () => {
  const fixture = artifactFixture();
  const checksumsPath = `/releases/download/${fixture.assets.tag}/${fixture.assets.checksums}`;
  fixture.files[checksumsPath] = formatChecksums([
    { name: fixture.assets.api, digest: sha256(fixture.apiArchive) },
  ]);
  const served = await serve(fixture.files);
  try {
    const error = await failure(
      resolveAdminArtifact({
        version: VERSION,
        apiUrl: API_URL,
        log: noop,
        env: environment(served.baseUrl),
      }),
    );

    expect(error.message).toContain(`does not list ${fixture.assets.admin}`);
  } finally {
    await served.close();
  }
});

it("rejects an artifact whose contents do not match the published checksum", async () => {
  const fixture = artifactFixture();
  fixture.files[fixture.adminPath] = zipSync({
    "open-next.output.json": new TextEncoder().encode("{}"),
  });
  const served = await serve(fixture.files);
  try {
    const error = await failure(
      resolveAdminArtifact({
        version: VERSION,
        apiUrl: API_URL,
        log: noop,
        env: environment(served.baseUrl),
      }),
    );

    expect(error.message).toContain("Integrity check failed");
    expect(error.message).toContain(fixture.assets.admin);
    expect(error.message).toContain(sha256(fixture.files[fixture.adminPath] as Uint8Array));
  } finally {
    await served.close();
  }
});

it("rejects an admin artifact without the deploy-time API placeholder", async () => {
  const fixture = artifactFixture();
  const asset = zipSync({
    "open-next.output.json": new TextEncoder().encode("{}"),
  });
  fixture.files[fixture.adminPath] = asset;
  fixture.files[`/releases/download/${fixture.assets.tag}/${fixture.assets.checksums}`] =
    formatChecksums([
      { name: fixture.assets.admin, digest: sha256(asset) },
      { name: fixture.assets.api, digest: sha256(fixture.apiArchive) },
    ]);
  const served = await serve(fixture.files);
  try {
    await expect(
      resolveAdminArtifact({
        version: VERSION,
        apiUrl: API_URL,
        log: noop,
        env: environment(served.baseUrl),
      }),
    ).rejects.toThrow(/placeholder/);
  } finally {
    await served.close();
  }
});

it("rewrites only text files when injecting the API URL", () => {
  const directory = mkdtempSync(join(tmpdir(), "provisionless-rewrite-"));
  writeFileSync(join(directory, "app.js"), `const api = "${API_URL_PLACEHOLDER}";`);
  writeFileSync(join(directory, "logo.bin"), Buffer.from(API_URL_PLACEHOLDER));

  expect(rewriteApiUrl(directory, API_URL_PLACEHOLDER, API_URL)).toBe(1);
  expect(readFileSync(join(directory, "app.js"), "utf8")).toBe(`const api = "${API_URL}";`);
  expect(readFileSync(join(directory, "logo.bin"))).toEqual(Buffer.from(API_URL_PLACEHOLDER));
});
