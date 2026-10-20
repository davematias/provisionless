# AGENTS.md

Guidance for agents (and people) working in the Provisionless repository.

## What this is

Provisionless is a serverless, headless CMS. This repository is an npm workspaces monorepo
orchestrated with Turborepo and written in TypeScript.

## Repository layout

```
.
├── packages/
│   ├── admin/            # @provisionless/admin — admin website
│   ├── api/              # @provisionless/api — content/backend API service
│   └── cli/              # @provisionless/cli — deploy CLI (single deploy entry point)
├── .oxfmtrc.json         # format config (repo-wide, Oxc)
├── .oxlintrc.json        # lint config (repo-wide, Oxc)
├── tsconfig.base.json    # shared TypeScript config, inherited by every package
├── turbo.json            # task orchestration (build/test/lint/typecheck)
├── package.json          # workspace root: pinned toolchain and scripts
└── README.md
```

Each package under `packages/*` has its own `package.json`, `tsconfig.json`, and `src/`. The
package `tsconfig.json` extends the root `tsconfig.base.json`.

## How the packages relate

- `admin`, `api`, and `cli` are independent workspace packages. Each installs, builds, typechecks,
  and tests on its own.
- `cli` is the deployment entry point that ships `admin` and `api`; it is expected to grow more
  subcommands over time.
- Reach another package through its public entry point, not by relative path into its `src/`. If a
  package genuinely depends on another, add a workspace dependency (`"@provisionless/x": "*"`)
  rather than a cross-package `../` import.

## Expected architecture and conventions

- TypeScript everywhere, ESM only (`"type": "module"`). Keep `strict` and the other safety flags
  from `tsconfig.base.json` on; do not weaken them per package without a documented reason.
- The intended deployment target is AWS and serverless: the admin app and API are meant to run on
  Lambda, and the CLI drives deployment. Avoid code that assumes a long-lived server.
- Keep secrets and deployment configuration out of the repo. Local env files and generated config
  are gitignored — never commit them.
- Generated output (`dist/`), `.turbo/`, and `node_modules/` are build artifacts and are
  gitignored. Do not edit or commit them.

## Testing

- **Unit tests are required** for every change. They live next to the code and are named
  `*.test.ts` (for example `packages/api/src/user.test.ts`).
- Run unit tests across all packages: `npm test`.
- Run one package's tests: `npm test --workspace=@provisionless/api`.
- **Integration tests are required** for any change that touches an external system (databases,
  cloud services, the network). They live next to the code and are named `*.integration.test.ts`,
  are excluded from the unit-test run, and run against an emulated service (for example the
  in-process `dynalite` DynamoDB emulator) so they need no external credentials.
- Run integration tests across all packages: `npm run test:integration`. They are not part of
  `npm run check`; CI runs them in a separate job.

## Quality gates

A change is not complete until all of these pass from the repository root:

- `npm run lint` — Oxlint across every package.
- `npm run typecheck` — `tsc --noEmit` for every package.
- `npm test` — unit tests for every package.
- `npm run format:check` — Oxfmt formatting check for the repository.

`npm run check` runs lint, typecheck, and test together via Turborepo, then `format:check`. Use
`npm run format` to apply formatting fixes.

`.github/workflows/ci.yml` runs these gates plus `npm run build` on every pull request and on pushes
to `main`. Reproduce the CI run locally with `npm run check && npm run build`.

## Finishing work

Do not leave finished work uncommitted: commit it on a feature branch, push the branch, and open a
pull request against `main`.

Commit messages and pull request titles use Conventional Commits (`type(scope)?: description`) with
an optional scope. Husky's `commit-msg` and `pre-commit` hooks enforce this and run lint/format on
staged files; do not bypass them with `--no-verify`.

## Common commands

```bash
npm install        # install all workspace dependencies
npm run build      # build every package
npm test           # run unit tests across packages
npm run test:integration  # run integration tests (emulated services)
npm run lint          # lint every package (oxlint)
npm run typecheck     # typecheck every package (TypeScript)
npm run format        # format the repo (oxfmt)
npm run format:check  # check formatting across the repo (oxfmt)
npm run check         # lint + typecheck + test + format:check
```

## Boundaries

- This repository is intended to become public. Do not include references to private or internal
  planning and tracking systems, their URLs, credentials, or internal task identifiers in any
  committed file (including code comments, docs, and commit messages).
