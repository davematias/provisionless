# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub's private vulnerability reporting:

https://github.com/davematias/provisionless/security/advisories/new

Do not open a public issue for a security problem. Include the affected commit or version, a
reproduction, and the impact you believe it has.

## Supported versions

Provisionless is pre-1.0. Fixes land on `main` and in the latest release; older releases are not
maintained separately.

## Automated checks

CI runs a dependency audit, gitleaks secret scanning, CodeQL static analysis, and the unit and
integration tests on every pull request. See [docs/repository-settings.md](docs/repository-settings.md)
for the repository security settings and [docs/quality-and-security.md](docs/quality-and-security.md)
for the local commands.
