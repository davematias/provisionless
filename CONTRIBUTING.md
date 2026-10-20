# Contributing

Thanks for your interest in Provisionless.

## Reporting issues

Open an issue describing the problem, what you expected, and how to reproduce it. For feature ideas, explain the use case and why it matters.

## Submitting changes

1. Fork the repository and create a branch from `main`.
2. Make your change and keep it focused; avoid unrelated edits.
3. Add or update tests where relevant.
4. Open a pull request describing the change and its motivation.

## Commit messages and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional-scope>): <description>
```

For example:

- `feat(api): add content search`
- `fix: reject expired reset tokens`
- `chore: bump dependencies`

Accepted types are `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, and `test`. Scopes are optional.

Husky installs Git hooks when you run `npm install`. The `commit-msg` hook validates the message with commitlint, and the `pre-commit` hook runs oxfmt and oxlint on staged files. Fix the reported issue rather than bypassing the hooks with `--no-verify`.

Pull request titles follow the same format and are validated in CI. When squash merging, use the pull request title as the commit message.

## Developer Certificate of Origin (DCO)

Every commit must be signed off. This certifies that you wrote the code or otherwise have the right to submit it, under the [Developer Certificate of Origin v1.1](https://developercertificate.org/).

Sign off with:

```bash
git commit -s
```

This appends a line to your commit message:

```
Signed-off-by: Your Name <your.email@example.com>
```

Pull requests with unsigned commits will be asked to amend before they can be merged.

## License

By contributing, you agree that your contributions are licensed under the project's [AGPL-3.0 license](LICENSE).
