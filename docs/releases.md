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

## Verifying a release

- `gh run list --workflow "Release Please"` shows the workflow runs.
- The release pull request lists the version bumps and changelog entries.
- After merging it, `gh release list` and `git tag` show the new tags and releases.
- `.release-please-manifest.json` and the changelogs contain the released versions.
