<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/lockup-dark.svg">
  <img src="brand/lockup.svg" alt="Provisionless logo" width="220">
</picture>

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

## API reference

The API (`@provisionless/api`) exposes a small Hono app. The [OpenAPI document](openapi.json) is the
single reference for every route, parameter, and request and response shape; `GET /openapi.json`
serves the same document at runtime. Regenerate it after changing routes:

```bash
npm run openapi:generate  # rewrite openapi.json from the route definitions
npm run openapi:check     # fail when the committed document has drifted
```

Routes are either public or protected by the `requireAuth` session middleware, which verifies the
session cookie, loads the user, and rejects requests with a missing or tampered token, a disabled
user, or a token issued before the user's last password change with `401`. Routes that manage users
or content schemas use `requireAdmin`, which adds `403` for non-admins. Handlers read the
authenticated user from the request context (`c.get("user")`), so registering a route behind
`requireAuth` inherits the same checks.

Password reset tokens are stored hashed in DynamoDB and consumed atomically, so each token works
once and expires; a successful reset bumps the user's `passwordChangedAt`, which invalidates their
existing sessions. Reset links are emailed through SES when `EMAIL_FROM_ADDRESS` is configured and
logged otherwise; both paths link to the admin app's `/reset` page.

## Content model

`@provisionless/core` provides the content model used by the API:

- **Content types** are identified by a slug and store a name plus fields. Each field has a name, a
  type (`string` or `boolean`), and an optional `required` flag.
- **Content entries** belong to a content type, have a UUID, and store values keyed by field name.
- `ContentTypeRepository` and `ContentEntryRepository` validate schemas and values before writing.
  Entry validation rejects missing required fields, wrong value types, and unknown fields.
- `provisionless deploy` provisions `<prefix>-content-types` and `<prefix>-content-entries` tables,
  keyed by `slug` and by `type` + `id` respectively; undeploy removes them unless data is kept.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to submit changes and the
[engineering standards](CONTRIBUTING.md#engineering-standards) covering layering, JSDoc, inline
comments, and API documentation.

## Quality and security

CI runs lint, typecheck, unit and integration tests, the formatting check, and the build on every
pull request and push to `main`, along with a dependency audit, secret scanning, and CodeQL static
analysis. See [docs/quality-and-security.md](docs/quality-and-security.md) for what each check
does, how to reproduce it locally, and how to handle a finding.

## License

Copyright (C) 2026 David Matias. Licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0). You are free to use, modify, and self-host it, including commercially. If you run a modified version as a network service, you must release your source under the same license.
