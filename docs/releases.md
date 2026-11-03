# Releases

Releases are automated with [release-please](https://github.com/googleapis/release-please). Merging
conventional commits to `main` opens or updates a release pull request with version bumps and
changelog entries. Merging that pull request creates the matching tags and GitHub releases.

## Packages

The manifest covers two packages:

| Path           | Package                  | Tag                             |
| -------------- | ------------------------ | ------------------------------- |
| `.`            | `provisionless-monorepo` | `provisionless-monorepo-vX.Y.Z` |
| `packages/cli` | `provisionless`          | `provisionless-vX.Y.Z`          |

The root release covers the repository as a whole. The CLI release is the one npm publishing and the
deploy artifacts use.

Private workspace packages (`@provisionless/admin`, `@provisionless/api`,
`@provisionless/design-system`, `@provisionless/tooling`, `@provisionless/website`) are deliberately
not in the manifest, so release-please ignores them. `@provisionless/core` is internal and is not
released either; the CLI consumes it through the workspace link.

`separate-pull-requests` is disabled, so both packages share one release pull request.

## Flow

1. Merge conventional commits to `main`.
2. The `Release Please` workflow opens or updates a release pull request titled `chore: release main`.
3. Review the version bumps and changelogs, then merge the pull request.
4. release-please creates the tags and GitHub releases and records the new versions in
   `.release-please-manifest.json` and the changelogs.
5. Publishing steps (npm and deploy artifacts) run from the release that follows.

Release pull requests run the same required checks as any other pull request. The maintainer can
approve them or use the admin bypass to merge their own.

## Token

The workflow uses `RELEASE_PLEASE_TOKEN`, a fine-grained personal access token stored as a repository
secret.

`GITHUB_TOKEN` is not sufficient: pull requests created with it do not trigger `pull_request`
workflows, so the required CI checks never report and the release pull request cannot merge.

Create the token at <https://github.com/settings/personal-access-tokens/new>:

- Repository access: only `davematias/provisionless`.
- Permissions: Contents (read and write), Pull requests (read and write), Issues (read and write).
- Set an expiry and rotate the secret before it lapses.

Store it with:

```bash
gh secret set RELEASE_PLEASE_TOKEN --repo davematias/provisionless
```

If the workflow fails with `401` or `403`, check that the secret exists, the token has not expired,
and it still has the permissions above.

## Configuration

- `release-please-config.json` defines the packages and the release type.
- `.release-please-manifest.json` tracks the current released version of each package. It starts at
  `0.0.0`; do not edit it by hand after the first release.

The first release is derived from the conventional commits since the beginning of the repository, so
it may be larger than later ones.

### Bootstrapping the first release

The root and CLI first releases were bootstrapped at `0.1.0` with `release-as`, because the node
releaser would otherwise start them at `1.0.0`. Those pins have been removed; later releases are
driven by conventional commits.

## Deploy artifacts

`provisionless deploy` needs two build outputs that are not part of the npm package: the admin
OpenNext output and the API Lambda deployment package. In a source checkout the CLI builds them
locally; anywhere else it downloads them from the GitHub release that matches its own version.

Each `provisionless-vX.Y.Z` release must carry:

| Asset                             | Contents                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| `provisionless-admin-vX.Y.Z.zip`  | `packages/admin/.open-next`: output manifest, server/image/revalidation bundles, assets, and cache |
| `provisionless-api-vX.Y.Z.zip`    | The API Lambda deployment package (`index.mjs`)                                                    |
| `provisionless-vX.Y.Z-SHA256SUMS` | SHA-256 digests for the two archives, in `sha256sum` format                                        |

The `Release artifacts` workflow runs when a release is published and its tag starts with
`provisionless-v`. It checks that the tag version matches `packages/cli/package.json`, builds the
admin output and API bundle, writes the checksum file, and uploads all three assets to the release.
A mismatch fails the job instead of publishing artifacts for the wrong version.

### Runtime API URL

The admin app compiles `NEXT_PUBLIC_API_URL` into its client bundles and its Content-Security-Policy
header. The release artifact is therefore built once with a placeholder origin
(`https://api.provisionless.invalid`). When the CLI prepares the artifact for a deployment it
replaces that origin in the unpacked text files with the deployment's API URL. The result is cached
per CLI version and API URL, so later deploys reuse it without rebuilding or downloading again.

### CLI resolution and cache

- The version comes from the installed `packages/cli/package.json`.
- Assets are fetched from
  `https://github.com/davematias/provisionless/releases/download/provisionless-vX.Y.Z/`. Set
  `PROVISIONLESS_RELEASE_BASE_URL` to use another mirror; the CLI appends the tag to that value.
- The checksum file is downloaded first and cached. Every archive is verified before use. A cached
  archive that no longer matches is downloaded again, the checksum list is refreshed once, and a
  persistent mismatch fails with the expected and actual digests.
- Missing assets fail with the CLI version, expected asset name, and release tag, so an incomplete
  release is obvious.
- The cache lives in `PROVISIONLESS_CACHE_DIR` when set, otherwise:
  - macOS: `~/Library/Caches/provisionless`
  - Windows: `%LOCALAPPDATA%\provisionless\Cache`
  - Linux: `$XDG_CACHE_HOME/provisionless` or `~/.cache/provisionless`
- Layout: `vX.Y.Z/` holds the downloaded archives and checksum file, plus one
  `admin-<api-url-hash>/` directory per API URL. Delete the version directory to reclaim space;
  there is no automatic pruning.

Inside a Provisionless source checkout the CLI keeps using the local build (`open-next build` and an
API bundle from source), so development does not download artifacts. Outside a checkout the current
directory is the project root and `.provisionless` is written there.

## npm publishing

The `provisionless` CLI is published to npm by the same workflow. The `publish-npm` job runs after
the deploy artifacts are attached and:

- checks that the `provisionless-vX.Y.Z` tag matches `packages/cli/package.json`;
- confirms the release carries both archives and the checksum file;
- confirms the version is not already on npm;
- asserts the tarball contains only runtime files;
- publishes with provenance.

### Package contents

`npm run build --workspace=provisionless` bundles the CLI with esbuild and inlines
`@provisionless/core`, so the published package has no dependency on that unpublished workspace
package. Only `dist/index.js` is published, alongside the automatically included `package.json` and
`README.md`. The release-artifact and package-verification scripts stay in `dist` for CI but are
excluded from the tarball. Check the contents locally with:

```bash
npm run build --workspace=provisionless
npm run verify:package --workspace=provisionless -- --tag provisionless-vX.Y.Z
```

### First publish and authentication

Trusted publishing cannot be configured before the package exists, so the first publish uses a
granular npm access token:

1. Create a granular token with read/write access to `provisionless` (and 2FA bypass for CI), then
   store it:

   ```bash
   gh secret set NPM_TOKEN --repo davematias/provisionless
   ```

2. Run the workflow for the existing release:

   ```bash
   gh workflow run release-artifacts.yml --ref main -f tag=provisionless-v0.1.0
   ```

3. Verify the published package:

   ```bash
   npm view provisionless version
   npm install -g provisionless@0.1.0
   provisionless --version
   ```

Once the package exists, configure a trusted publisher at npmjs.com → `provisionless` → Settings →
Trusted publishing → GitHub Actions with user `davematias`, repository `provisionless`, workflow
`release-artifacts.yml`, and the `npm publish` action allowed. Then delete the `NPM_TOKEN` secret;
the workflow falls back to OIDC and still generates provenance. Restricting the package to trusted
publishers only is recommended once the switch works.

### Retrying a publish

`workflow_dispatch` with a release tag rebuilds the artifacts and retries the npm publish. It fails
loudly when the tag, package version, release assets, or npm version do not match.

## Verifying a release

- `gh run list --workflow "Release Please"` shows the workflow runs.
- The release pull request lists the version bumps and changelog entries.
- After merging it, `gh release list` and `git tag` show the new tags and releases.
- `.release-please-manifest.json` and the changelogs contain the released versions.
- `gh run list --workflow "Release artifacts"` shows the artifact job for the CLI release.
- `gh release view provisionless-vX.Y.Z` lists the admin archive, API archive, and checksum file.
- `sha256sum -c provisionless-vX.Y.Z-SHA256SUMS` succeeds in a directory with the two archives.
- `npm view provisionless version` reports the released CLI version.
- `npm install -g provisionless@X.Y.Z` then `provisionless --version` reports the released version.
- Running the released CLI outside a checkout (`npx provisionless@X.Y.Z deploy --dry-run`) reports the
  artifacts being downloaded and verified on the first run and reused on the next.
