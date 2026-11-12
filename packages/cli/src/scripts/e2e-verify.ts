import { pathToFileURL } from "node:url";

/** Minimal fetch signature, so tests can substitute responses without a network. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** A deployment the end-to-end release gate provisioned and now has to verify. */
export interface DeploymentCheckOptions {
  apiUrl: string;
  adminUrl: string;
  username: string;
  password: string;
}

export interface VerifyOptions extends DeploymentCheckOptions {
  fetch?: Fetch;
}

function trimTrailingSlash(url: string): string {
  return url.trim().replace(/\/+$/u, "");
}

function originOf(url: string): string {
  try {
    return new URL(trimTrailingSlash(url)).origin;
  } catch {
    throw new Error(`"${url}" is not a valid URL.`);
  }
}

async function expectOk(response: Response, label: string): Promise<Response> {
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}.`);
  }
  return response;
}

/** Reads an attribute from a JSON response, refusing anything that is not an object. */
async function readObject(response: Response, label: string): Promise<Record<string, unknown>> {
  const body = (await response.json()) as unknown;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error(`${label} did not return a JSON object.`);
  }
  return body as Record<string, unknown>;
}

/** Asserts the deployed API serves the generated OpenAPI document. */
export async function verifyOpenApi(apiUrl: string, request: Fetch = fetch): Promise<void> {
  const url = `${trimTrailingSlash(apiUrl)}/openapi.json`;
  const response = await expectOk(await request(url), `GET ${url}`);

  const document = await readObject(response, `GET ${url}`);
  if (document.openapi !== "3.0.3") {
    throw new Error(`${url} returned OpenAPI ${String(document.openapi)}, expected 3.0.3.`);
  }
  const paths = document.paths;
  if (typeof paths !== "object" || paths === null || Object.keys(paths).length === 0) {
    throw new Error(`${url} lists no API paths.`);
  }
}

/** Asserts the seeded test user can sign in against the deployed API. */
export async function verifyLogin(
  options: { apiUrl: string; username: string; password: string },
  request: Fetch = fetch,
): Promise<void> {
  const url = `${trimTrailingSlash(options.apiUrl)}/auth/login`;
  const response = await request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: options.username, password: options.password }),
  });
  await expectOk(response, `POST ${url}`);

  const body = await readObject(response, `POST ${url}`);
  const user = body.user;
  if (typeof user !== "object" || user === null) {
    throw new Error(`POST ${url} did not return the signed-in user.`);
  }
  if ((user as Record<string, unknown>).username !== options.username) {
    throw new Error(`POST ${url} did not sign in "${options.username}".`);
  }
}

/** Finds a client asset the admin page references, preferring a script bundle. */
export function adminAssetPath(html: string): string {
  const match = /(?:src|href)="([^"]*\/_next\/static\/[^"]+)"/u.exec(html);
  if (!match?.[1]) {
    throw new Error("The admin page does not reference any /_next/static client assets.");
  }
  return match[1];
}

/** Asserts the admin site serves through CloudFront with the deployed API origin and its assets. */
export async function verifyAdmin(
  options: { adminUrl: string; apiUrl: string },
  request: Fetch = fetch,
): Promise<void> {
  const adminUrl = trimTrailingSlash(options.adminUrl);
  const response = await expectOk(await request(`${adminUrl}/`), "The admin site");

  const policy = response.headers.get("content-security-policy");
  if (!policy) {
    throw new Error("The admin site did not return a Content-Security-Policy header.");
  }

  const apiOrigin = originOf(options.apiUrl);
  const connectDirective = /(?:^|;)\s*connect-src ([^;]+)/u.exec(policy)?.[1];
  if (!connectDirective?.split(/\s+/u).includes(apiOrigin)) {
    throw new Error(
      `The admin Content-Security-Policy does not allow the deployed API origin ${apiOrigin}.`,
    );
  }

  const assetPath = adminAssetPath(await response.text());
  const assetUrl = new URL(assetPath, `${adminUrl}/`).toString();
  const asset = await request(assetUrl);
  if (!asset.ok) {
    throw new Error(`The admin client asset ${assetPath} returned HTTP ${asset.status}.`);
  }
}

/** Runs every end-to-end deployment check and throws on the first failure. */
export async function verifyDeployment(options: VerifyOptions): Promise<void> {
  const request = options.fetch ?? fetch;
  await verifyOpenApi(options.apiUrl, request);
  await verifyLogin(options, request);
  await verifyAdmin(options, request);
}

function parseArguments(argv: readonly string[]): DeploymentCheckOptions {
  const values = new Map<string, string>();
  const names = new Set(["--api-url", "--admin-url", "--username", "--password"]);

  for (let index = 0; index < argv.length; index += 2) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (!argument || !names.has(argument)) {
      throw new Error(`Unknown option "${argument ?? ""}".`);
    }
    if (!value) {
      throw new Error(`${argument} requires a value.`);
    }
    values.set(argument, value);
  }

  const apiUrl = values.get("--api-url");
  const adminUrl = values.get("--admin-url");
  const username = values.get("--username");
  const password = values.get("--password");
  if (!apiUrl || !adminUrl || !username || !password) {
    throw new Error(
      "Usage: e2e-verify.js --api-url <url> --admin-url <url> --username <name> --password <password>",
    );
  }
  return { apiUrl, adminUrl, username, password };
}

const invoked = process.argv[1];
if (invoked && import.meta.url === pathToFileURL(invoked).href) {
  verifyDeployment(parseArguments(process.argv.slice(2)))
    .then(() => {
      process.stdout.write("End-to-end deployment checks passed.\n");
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
