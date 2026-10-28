# Quality and security

These checks run on every pull request and push to `main`. This page explains what each one does,
how to run it locally, and how to handle findings. For the repository-level protections and security
settings, see [repository-settings.md](repository-settings.md).

## Continuous integration

GitHub Actions runs typecheck, lint, unit tests, integration tests, the formatting check, and the
build on every pull request and on pushes to `main` (see `.github/workflows/ci.yml`). Run the same
checks locally with `npm run check && npm run test:integration && npm run build`.

## Dependency security

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

### Dependabot

Dependabot opens version and security update PRs from the root npm workspace. Its configuration is
`.github/dependabot.yml`:

- `directory: "/"` makes Dependabot resolve the whole workspace and update the root
  `package-lock.json`. Pointing it at a workspace directory produces manifest-only PRs that fail
  `npm ci`.
- `commit-message.prefix` plus `include: "scope"` produces conventional titles such as
  `chore(deps): Bump ...` or `chore(deps-dev): Bump ...`, so the `Validate PR title` check passes.

## Secret scanning

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

### If a secret is detected

1. Treat the value as compromised. Revoke or rotate it with the provider immediately, then update the
   deployment secret or configuration with the replacement.
2. Remove the value from the branch. Rewriting history does not undo the exposure: assume anything
   pushed to the repository is public.
3. Check the provider's audit logs for use of the credential after it was exposed, and revoke it
   again if it was already used.
4. If the finding is a false positive, add a documented entry to `.gitleaks.toml`; never add a real
   credential to the allowlist.

## Static analysis

CI runs [CodeQL](https://codeql.github.com/) over the JavaScript and TypeScript sources on every pull
request and push to `main`, using the pinned `security-extended` query suite. The `Static analysis`
job fails when a result is error-level or has a high or critical security severity (7.0 or above),
so high-confidence findings such as XSS, injection, SSRF, unsafe eval, and path traversal block the
merge. Lower-severity results are listed in the job log without failing.

The report is uploaded to GitHub code scanning, so findings also appear under Security → Code
scanning. The job still runs the local gate and fails on error-level or high/critical findings, so a
failed upload cannot silently pass the check. Test files are excluded from the analysis
(`.github/codeql/codeql-config.yml`) because their log assertions trip URL-sanitization heuristics;
lint, typecheck, unit tests, and the secret scan still cover them.

Reproduce the scan locally with the [CodeQL CLI](https://docs.github.com/en/code-security/codeql-cli):

```bash
mkdir -p codeql-results
codeql database create codeql-db --language=javascript-typescript --build-mode=none
codeql database analyze codeql-db \
  codeql/javascript-queries:codeql-suites/javascript-security-extended.qls \
  --format=sarif-latest --output=codeql-results/javascript.sarif
npm run sast:gate --workspace=@provisionless/tooling -- codeql-results
```
