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
