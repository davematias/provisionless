# Provisionless

A serverless, headless CMS.

## Goal

A lightweight, self-hosted headless CMS with no infrastructure to provision or maintain.

## Packages

This is an npm workspaces monorepo. The shipped product is made of three co-located components:

| Package                | Directory        | Purpose                                                         |
| ---------------------- | ---------------- | --------------------------------------------------------------- |
| `@provisionless/admin` | `packages/admin` | Admin website for managing content.                             |
| `@provisionless/api`   | `packages/api`   | Backend/content API service.                                    |
| `@provisionless/cli`   | `packages/cli`   | Deploy CLI; the single entry point for deploying Provisionless. |

Each package lives under `packages/*`, installs and builds independently, and inherits a shared
TypeScript config (`tsconfig.base.json` at the repo root).

## Development

Requires Node.js 22+ and npm 11+ (pinned in `package.json` via `packageManager` and `engines`).

```bash
npm install        # install all workspace dependencies
npm run build      # build every package (Turbo)
npm test           # run unit tests across packages (Vitest via Turbo)
npm run lint       # lint every package (oxlint)
npm run typecheck  # typecheck every package (TypeScript)
npm run audit      # scan dependencies for known vulnerabilities
npm run format     # format the repo (oxfmt)
```

Tasks are orchestrated with [Turborepo](turbo.json); each command above fans out to the workspace
packages. Run a script for a single package with `npm run <script> --workspace=<package-name>`, e.g.
`npm run build --workspace=@provisionless/api`.

### Dependency security

`npm run audit` scans the whole workspace dependency tree with `npm audit` and fails when it finds a
high or critical advisory that is not listed as a reviewed exception. Moderate and low advisories are
reported without failing. CI runs the same check on every pull request and on pushes to `main`.

Reviewed exceptions live in `packages/tooling/audit-allowlist.json`. Each entry names the affected
package, the advisory id, a reason, and an expiry date (`YYYY-MM-DD`) after which the exception stops
being accepted and must be re-reviewed:

```json
[
  {
    "package": "example-package",
    "id": "GHSA-aaaa-bbbb-cccc",
    "reason": "Only reachable from build tooling; fix tracked upstream.",
    "expires": "2026-12-31"
  }
]
```

### Secret scanning

CI runs [gitleaks](https://github.com/gitleaks/gitleaks) over the commits in every pull request and
push to `main` with the default rule set, pinned to gitleaks 8.30.1. The `Secret scan` job fails when
it detects a credential. Reviewed false positives live in `.gitleaks.toml`, which extends the default
rules:

```toml
[[allowlists]]
description = "Example placeholder key in the documentation"
condition = "AND"
paths = ['''docs/.*\.md''']
regexes = ['''example-not-a-real-key''']
```

Keep exclusions narrow — a specific path and, when possible, the exact value — and record why the
value is not a credential. Removing or replacing the value is always better than allowlisting it.

Run the same scan locally with Docker:

```bash
docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:v8.30.1 \
  git --config /repo/.gitleaks.toml /repo
```

#### If a secret is detected

1. Treat the value as compromised. Revoke or rotate it with the provider immediately, then update the
   deployment secret or configuration with the replacement.
2. Remove the value from the branch. Rewriting history does not undo the exposure: assume anything
   pushed to the repository is public.
3. Check the provider's audit logs for use of the credential after it was exposed, and revoke it
   again if it was already used.
4. If the finding is a false positive, add a documented entry to `.gitleaks.toml`; never add a real
   credential to the allowlist.

### Static analysis

CI runs [CodeQL](https://codeql.github.com/) over the JavaScript and TypeScript sources on every pull
request and push to `main`, using the pinned `security-extended` query suite. The `Static analysis`
job fails when a result is error-level or has a high or critical security severity (7.0 or above),
so high-confidence findings such as XSS, injection, SSRF, unsafe eval, and path traversal block the
merge. Lower-severity results are listed in the job log without failing.

The report is not uploaded to GitHub code scanning because that requires GitHub Advanced Security for
private repositories; the SARIF file produced during the job is the source of truth. Test files are
excluded from the analysis (`.github/codeql/codeql-config.yml`) because their log assertions trip
URL-sanitization heuristics; lint, typecheck, unit tests, and the secret scan still cover them.

Reproduce the scan locally with the [CodeQL CLI](https://docs.github.com/en/code-security/codeql-cli):

```bash
mkdir -p codeql-results
codeql database create codeql-db --language=javascript-typescript --build-mode=none
codeql database analyze codeql-db \
  codeql/javascript-queries:codeql-suites/javascript-security-extended.qls \
  --format=sarif-latest --output=codeql-results/javascript.sarif
npm run sast:gate --workspace=@provisionless/tooling -- codeql-results
```

## API routes

The API (`@provisionless/api`) exposes a small Hono app. Routes are either public or protected by
the `requireAuth` session middleware, which verifies the session cookie, loads the user, and rejects
requests with a missing or tampered token, a disabled user, or a token issued before the user's last
password change with `401`.

| Route                         | Access    | Purpose                                                                                  |
| ----------------------------- | --------- | ---------------------------------------------------------------------------------------- |
| `GET /health`                 | Public    | Liveness check.                                                                          |
| `GET /openapi.json`           | Public    | OpenAPI 3.0 document describing the API.                                                 |
| `POST /auth/login`            | Public    | Verify credentials and set the session cookie.                                           |
| `POST /auth/logout`           | Public    | Clear the session cookie.                                                                |
| `GET /auth/me`                | Protected | Return the current user and refresh the session cookie.                                  |
| `POST /auth/reset/request`    | Public    | Create a single-use password reset token (same response whether or not the user exists). |
| `POST /auth/reset/link`       | Admin     | Create a single-use reset link to share manually, without sending email.                 |
| `POST /auth/reset/confirm`    | Public    | Consume a reset token and set a new password, invalidating existing sessions.            |
| `GET /users`                  | Admin     | List users without password data.                                                        |
| `POST /users`                 | Admin     | Create a user with a hashed password.                                                    |
| `PATCH /users/:username`      | Admin     | Enable/disable a user, toggle `isAdmin`, or update profile fields.                       |
| `GET /content-types`          | Admin     | List content schemas sorted by slug.                                                     |
| `GET /content-types/:slug`    | Admin     | Read a content schema.                                                                   |
| `PUT /content-types/:slug`    | Admin     | Create or replace a content schema.                                                      |
| `DELETE /content-types/:slug` | Admin     | Delete a content schema and all of its entries.                                          |
| `GET /content/:slug`          | Protected | List entries for a content type.                                                         |
| `GET /content/:slug/:id`      | Protected | Read one content entry.                                                                  |
| `POST /content/:slug`         | Protected | Create a content entry.                                                                  |
| `PUT /content/:slug/:id`      | Protected | Replace a content entry's values.                                                        |
| `DELETE /content/:slug/:id`   | Protected | Delete a content entry.                                                                  |

Protected routes read the authenticated user from the request context (`c.get("user")`); register new
routes behind `requireAuth` so they inherit the same checks. Admin-only routes (reset links and user
management) use `requireAdmin`, which adds a `403` for non-admins. Password reset tokens are stored
hashed in DynamoDB and consumed atomically, so each token works once and expires; a successful reset
bumps the user's `passwordChangedAt`, which invalidates their existing sessions. Reset links are
emailed through SES when `EMAIL_FROM_ADDRESS` is configured and logged otherwise; both paths link to
the admin app's `/reset` page.

## Content model

`@provisionless/core` provides the content model used by the API:

- **Content types** are identified by a slug and store a name plus fields. Each field has a name, a
  type (`string` or `boolean`), and an optional `required` flag.
- **Content entries** belong to a content type, have a UUID, and store values keyed by field name.
- `ContentTypeRepository` and `ContentEntryRepository` validate schemas and values before writing.
  Entry validation rejects missing required fields, wrong value types, and unknown fields.
- `provisionless deploy` provisions `<prefix>-content-types` and `<prefix>-content-entries` tables,
  keyed by `slug` and by `type` + `id` respectively; undeploy removes them unless data is kept.

## Continuous integration

GitHub Actions runs typecheck, lint, unit tests, integration tests, the formatting check, and the
build on every pull request and on pushes to `main` (see `.github/workflows/ci.yml`). Run the same
checks locally with `npm run check && npm run test:integration && npm run build`.

## License

Copyright (C) 2026 David Matias. Licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0). You are free to use, modify, and self-host it, including commercially. If you run a modified version as a network service, you must release your source under the same license.
