# Provisionless

A serverless, headless CMS.

## Goal

A lightweight, self-hosted headless CMS with no infrastructure to provision or maintain.

## Packages

This is an npm workspaces monorepo. The shipped product is made of three co-located components:

| Package | Directory | Purpose |
|---|---|---|
| `@provisionless/admin` | `packages/admin` | Admin website for managing content. |
| `@provisionless/api` | `packages/api` | Backend/content API service. |
| `@provisionless/cli` | `packages/cli` | Deploy CLI; the single entry point for deploying Provisionless. |

Each package lives under `packages/*`, installs and builds independently, and inherits a shared
TypeScript config (`tsconfig.base.json` at the repo root).

## Development

Requires Node.js 22+ and npm 11+ (pinned in `package.json` via `packageManager` and `engines`).

```bash
npm install        # install all workspace dependencies
npm run build      # build every package (Turbo)
npm test           # run unit tests across packages (Vitest via Turbo)
npm run lint       # lint every package (Biome)
npm run typecheck  # typecheck every package (TypeScript)
npm run format     # format the repo (Biome)
```

Tasks are orchestrated with [Turborepo](turbo.json); each command above fans out to the workspace
packages. Run a script for a single package with `npm run <script> --workspace=<package-name>`, e.g.
`npm run build --workspace=@provisionless/api`.

## License

Copyright (C) 2026 David Matias. Licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0). You are free to use, modify, and self-host it, including commercially. If you run a modified version as a network service, you must release your source under the same license.
