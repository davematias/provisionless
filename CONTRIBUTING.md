# Contributing

Thanks for your interest in Provisionless.

## Reporting issues

Open an issue describing the problem, what you expected, and how to reproduce it. For feature ideas, explain the use case and why it matters.

## Submitting changes

1. Fork the repository and create a branch from `main`.
2. Make your change and keep it focused; avoid unrelated edits.
3. Add or update tests where relevant.
4. Open a pull request describing the change and its motivation.

All changes land through pull requests: `main` is protected by a ruleset that requires the CI checks
and blocks force pushes and deletion. See [docs/repository-settings.md](docs/repository-settings.md)
for the required checks and the other repository settings.

## Engineering standards

These conventions keep the codebase reviewable as it grows. Reviews hold changes to them.

### Layer responsibilities

Backend code is split into three layers. Each layer has one job, and code that belongs in another
layer moves rather than accumulates.

| Layer              | Lives in                                | Owns                                                                                               | Must not                                                      |
| ------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Route / controller | `packages/api/src/<feature>/routes.ts`  | HTTP: method and path, middleware, body parsing, status codes, response shape, OpenAPI metadata    | Business rules, validation of domain values, repository calls |
| Service            | `packages/api/src/<feature>/service.ts` | Use cases: domain validation, orchestration across repositories, permission rules, typed errors    | Hono contexts, request/response shapes, status codes          |
| Repository         | `packages/core/src/<feature>/*.ts`      | Persistence: reading and writing DynamoDB, mapping items to domain objects, uniqueness and atomics | HTTP concerns, transport error types, application workflow    |

Rules that follow from the table:

- A route handler parses the request, calls one service function, then maps the outcome to a
  response. Error-to-status-code mapping is the handler's job; deciding whether something is an
  error is the service's.
- A service accepts plain values and returns domain results or typed errors. It never receives a
  Hono context and never sets a status code, so it can be unit-tested without a router.
- A repository knows only its table. When a use case spans repositories, the service orchestrates
  them; repositories never call each other.
- Dependencies are injected (`createApp(deps)` today) so tests can substitute stores and the layers
  stay swappable.

The API is moving toward this split. When you touch a handler that still validates or orchestrates
inline, move that logic into the service layer as part of the change instead of adding to it.

#### Concrete example: disabling a user

The `PATCH /users/:username` flow with `{ "enabled": false }` shows the boundary. The route is
HTTP-only:

```ts
// packages/api/src/users/routes.ts
app.patch(
  "/users/:username",
  describeRoute({
    tags: ["Users"],
    summary: "Update a user",
    operationId: "updateUser",
    security: SECURITY,
    parameters: [pathParameter("username")],
    requestBody: jsonRequest(UpdateUserRequestSchema),
    responses: {
      200: jsonResponse(UserResponseSchema, "User updated"),
      400: validationErrorResponse("Invalid user update"),
      404: errorResponse("User not found"),
      409: errorResponse("The last admin cannot be disabled"),
    },
  }),
  requireAdmin(deps),
  async (c) => {
    const body = await c.req.json().catch(() => undefined);
    if (!isRecord(body)) {
      return c.json({ error: "A JSON body is required" }, 400);
    }

    try {
      const user = await deps.users.updateUser(c.req.param("username"), body);
      return c.json({ user: toPublicUser(user) });
    } catch (error) {
      if (error instanceof InvalidUserFieldError) {
        return c.json({ error: error.message }, 400);
      }
      if (error instanceof UserNotFoundError) {
        return c.json({ error: "User not found" }, 404);
      }
      if (error instanceof LastAdminError) {
        return c.json({ error: "The last admin cannot be disabled" }, 409);
      }
      throw error;
    }
  },
);
```

The service owns the rules, validates the plain input, and has no idea an HTTP request exists:

```ts
// packages/api/src/users/service.ts
export class UserService {
  readonly #users: UserManagementStore;

  constructor(users: UserManagementStore) {
    this.#users = users;
  }

  /**
   * Applies a partial update to one user. Disabling the last enabled admin is refused so the
   * deployment cannot lock itself out of user management.
   *
   * @throws {InvalidUserFieldError} When a supplied field has the wrong type or is empty.
   * @throws {UserNotFoundError} When no user has the given username.
   * @throws {LastAdminError} When the update would disable the last enabled admin.
   */
  async updateUser(username: string, changes: unknown): Promise<User> {
    const input = parseUserChanges(changes);
    const existing = await this.#users.getUser(username);
    if (!existing) {
      throw new UserNotFoundError(username);
    }
    if (input.enabled === false && existing.isAdmin) {
      const admins = (await this.#users.listUsers()).filter((user) => user.isAdmin && user.enabled);
      if (admins.length === 1) {
        throw new LastAdminError(username);
      }
    }
    return this.#users.updateUser(username, input);
  }
}
```

The repository only reads and writes its table:

```ts
// packages/core/src/users/repository.ts
export class UserRepository {
  /**
   * Writes the given fields for one user and returns the stored record.
   *
   * @throws {ConditionalCheckFailedException} When the user was deleted in the meantime.
   */
  async updateUser(username: string, changes: UpdateUserInput): Promise<User> {
    // DynamoDB UpdateCommand; no validation and no knowledge of who called it.
  }
}
```

### JSDoc

Write JSDoc where a reader of the public API cannot infer the contract from the signature. Which
declarations need it is fixed; how much to write is a judgment call.

JSDoc is required on:

- every function, class, and exported constant reachable from a package entry point
  (`packages/*/src/index.ts` or the package's `exports`), i.e. anything a consumer of
  `@provisionless/core`, `@provisionless/api`, `@provisionless/design-system`, or the
  `provisionless` CLI can import;
- every exported service method and typed error, because callers must know what to catch;
- internal functions whose purpose or contract is not obvious from the name.

JSDoc is not required on test files, local helpers, single-use callbacks, or generated re-export
lists. A one-line summary is enough when nothing else is surprising.

JSDoc must convey what the types cannot:

- the purpose of the declaration in one sentence on the first line;
- non-obvious inputs and outputs, including constraints the type does not express;
- side effects: network calls, filesystem writes, clock or environment reads;
- errors callers must handle, via `@throws`;
- units, formats, ordering, and lifetime or expiry rules.

JSDoc must not:

- restate parameter types or obvious behavior (`@param username The username`);
- narrate the implementation line by line, which belongs in inline comments if anywhere;
- duplicate the OpenAPI summary and description verbatim;
- keep stale examples or references to removed code.

```ts
// Bad: repeats the signature and says nothing a reader could not see.
/**
 * Updates the user.
 * @param username The username.
 * @param changes The changes.
 * @returns The user.
 */
async updateUser(username: string, changes: UpdateUserInput): Promise<User> {}

// Good: adds the contract the types cannot express.
/**
 * Applies a partial update to one user. Supplying `password` bumps `passwordChangedAt`, which
 * invalidates that user's existing sessions.
 *
 * @throws {InvalidUserFieldError} When a supplied field has the wrong type or is empty.
 * @throws {UserNotFoundError} When no user has the given username.
 */
async updateUser(username: string, changes: UpdateUserInput): Promise<User> {}
```

### Inline comments

Inline comments explain why, not what. The code already says what.

Write one when:

- the intent or ordering is not obvious from the code, such as a workaround for a library or
  browser quirk;
- a decision is security-relevant, such as why a token is hashed before storage or why a check
  happens before a write;
- an invariant or precondition must hold, especially one the type system cannot express;
- a line looks wrong but is deliberate, and the reason is not in the code;
- you are citing a specification, RFC, or upstream issue. Link it; do not paste the workaround's
  history.

Do not write one when:

- it restates the next line (`// increment the counter`) or sections off self-evident code;
- it narrates the change or the author (`// added by ...`, `// new`, `// refactored`);
- it keeps dead code alive; delete the code, Git keeps the history;
- it is a `TODO` with no landing condition. If a `TODO` is unavoidable, say what makes it
  removable, for example the upstream fix it waits on.

### API reference

The API reference is the OpenAPI document generated from the route definitions and committed at the
repository root as `openapi.json`. It is the single source of truth for endpoints, parameters, and
request and response shapes.

When a route changes, update its `describeRoute` metadata in the same change and regenerate the
document. READMEs link to it instead of enumerating endpoints, parameters, or payloads; they stay
useful by covering setup, architecture, configuration, and behavior that OpenAPI cannot express.

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
