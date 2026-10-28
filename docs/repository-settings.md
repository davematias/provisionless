# Repository settings

Some launch-critical settings live in GitHub rather than in this repository. This page records the
current values and how to change them so they can be reviewed and restored.

## `main` ruleset

The default branch is protected by the repository ruleset `main` (Settings → Rules → Rulesets). It
applies to `main` and has no bypass actors, so administrators are covered too.

- Changes merge only through a pull request.
- Squash merges only.
- Force pushes and branch deletion are blocked.
- All review conversations must be resolved.
- No approving review is required, so the solo maintainer can merge their own pull requests.
- Required status checks must pass, and the branch must be up to date with `main` before merging.

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

Use the GitHub UI or the API. The ruleset and security toggles can be inspected and updated with:

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
- A compliant pull request merges with a squash commit.
- `gh api repos/davematias/provisionless/rulesets` lists the active ruleset.

## Social preview

Upload `brand/png/social-preview-1280x640.png` under Settings → General → Social preview. GitHub has
no API for this image and only exposes the section on public repositories.
