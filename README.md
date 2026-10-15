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
npm run format     # format the repo (oxfmt)
```

Tasks are orchestrated with [Turborepo](turbo.json); each command above fans out to the workspace
packages. Run a script for a single package with `npm run <script> --workspace=<package-name>`, e.g.
`npm run build --workspace=@provisionless/api`.

## API routes

The API (`@provisionless/api`) exposes a small Hono app. Routes are either public or protected by
the `requireAuth` session middleware, which verifies the session cookie, loads the user, and rejects
requests with a missing or tampered token, a disabled user, or a token issued before the user's last
password change with `401`.

| Route                      | Access    | Purpose                                                                                  |
| -------------------------- | --------- | ---------------------------------------------------------------------------------------- |
| `GET /health`              | Public    | Liveness check.                                                                          |
| `POST /auth/login`         | Public    | Verify credentials and set the session cookie.                                           |
| `POST /auth/logout`        | Public    | Clear the session cookie.                                                                |
| `GET /auth/me`             | Protected | Return the current user and refresh the session cookie.                                  |
| `POST /auth/reset/request` | Public    | Create a single-use password reset token (same response whether or not the user exists). |
| `POST /auth/reset/confirm` | Public    | Consume a reset token and set a new password, invalidating existing sessions.            |

Protected routes read the authenticated user from the request context (`c.get("user")`); register new
routes behind `requireAuth` so they inherit the same checks. Password reset tokens are stored hashed
in DynamoDB and consumed atomically, so each token works once and expires; a successful reset bumps
the user's `passwordChangedAt`, which invalidates their existing sessions.

## Continuous integration

GitHub Actions runs typecheck, lint, unit tests, integration tests, the formatting check, and the
build on every pull request and on pushes to `main` (see `.github/workflows/ci.yml`). Run the same
checks locally with `npm run check && npm run test:integration && npm run build`.

## License

Copyright (C) 2026 David Matias. Licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0). You are free to use, modify, and self-host it, including commercially. If you run a modified version as a network service, you must release your source under the same license.
