# Repository settings

Some launch-critical settings live in GitHub rather than in this repository. This page records the
current values and how to change them so they can be reviewed and restored.

## `main` rulesets

The default branch is protected by two repository rulesets (Settings → Rules → Rulesets). Both apply
to `main`, and rulesets are cumulative.

### `main checks`

This ruleset has no bypass actors, so it applies to everyone, including administrators.

- Force pushes and branch deletion are blocked.
- Required status checks must pass, and the branch must be up to date with `main` before merging.

### `main reviews`

This ruleset holds the review requirements and has one bypass actor: the repository admin role,
with bypass mode `pull_request`.

- Changes merge only through a pull request.
- Squash merges only.
- All review conversations must be resolved.
- One approving review is required. GitHub does not allow approving your own pull request, so the
  admin bypass is how the sole maintainer merges their own work. The bypass only applies when
  merging a pull request and only bypasses this ruleset; the required checks in `main checks` still
  apply.

### Required checks

| Check                              | Workflow |
| ---------------------------------- | -------- |
| Typecheck, lint, unit tests, build | CI       |
| Dependency audit                   | CI       |
| Secret scan                        | CI       |
| Static analysis                    | CI       |
| Integration tests                  | CI       |
| Validate PR title                  | PR title |

The names must match the job names in `.github/workflows/ci.yml` and
`.github/workflows/pr-title.yml`. Renaming a job means updating the ruleset; otherwise pull requests
wait forever for a check that will never report under the old name.

## Security features

| Feature                         | Setting                                              |
| ------------------------------- | ---------------------------------------------------- |
| Secret scanning                 | Enabled, with push protection                        |
| Private vulnerability reporting | Enabled; see [SECURITY.md](../SECURITY.md)           |
| Dependabot alerts               | Enabled                                              |
| Dependabot security updates     | Enabled                                              |
| CodeQL code scanning            | Enabled by the `Static analysis` job uploading SARIF |

Code scanning uses the workflow rather than GitHub's default setup because the project needs the
`security-extended` query suite and the local severity gate. Do not enable default setup while the
`Static analysis` job exists.

## Changing the settings

Use the GitHub UI or the API. The rulesets and security toggles can be inspected and updated with:

```bash
gh api repos/davematias/provisionless/rulesets
gh api repos/davematias/provisionless/rulesets/<id>
gh repo edit davematias/provisionless --enable-secret-scanning --enable-secret-scanning-push-protection
gh api -X PUT repos/davematias/provisionless/vulnerability-alerts
gh api -X PUT repos/davematias/provisionless/automated-security-fixes
gh api -X PUT repos/davematias/provisionless/private-vulnerability-reporting
```

After renaming a workflow job or adding a required check, update the ruleset in the same change and
verify it with a pull request.

## Verifying protections

- A direct push to `main` is rejected.
- A pull request with a failing required check cannot merge.
- A pull request without an approval is blocked for contributors; the admin can still merge their own
  through the review ruleset bypass.
- A compliant pull request merges with a squash commit.
- `gh api repos/davematias/provisionless/rulesets` lists both active rulesets.

## Social preview

Upload `brand/png/social-preview-1280x640.png` under Settings → General → Social preview. GitHub has
no API for this image and only exposes the section on public repositories.
