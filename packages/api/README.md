# @provisionless/api

The Provisionless backend/content API, built with [Hono](https://hono.dev).

## Local development

From the repository root:

```bash
npm run dev --workspace=@provisionless/api
```

The server listens on http://localhost:3000 (override with `PORT`). It runs the TypeScript
sources directly using Node's built-in type stripping, so no build step is required.

### Auth and cross-site sessions

`POST /auth/login`, `POST /auth/logout`, and `GET /auth/me` establish a session cookie that the admin
site uses. When the admin app is served from a different origin, set:

- `AUTH_ALLOW_ORIGINS` — comma-separated origins allowed to call the API with credentials (for example
  `http://localhost:3000` in local development). Without it no CORS headers are emitted.
- `AUTH_COOKIE_SAMESITE=None` — required only when admin and API are on genuinely different sites;
  the cookie is then always `Secure`. Leave unset (`Lax`) for same-site setups like localhost.
- `AUTH_COOKIE_SECURE=true` — mark cookies `Secure` in local development when using `Lax`.

`provisionless deploy` sets these automatically for the deployed admin and API URLs.

### Password reset

`POST /auth/reset/request` (body `{ "username": "..." }`) creates a single-use, expiring token for
the user and returns `{ "ok": true }`; it returns the same response for unknown usernames, so it never
reveals whether an account exists. Only a hash of the token is stored, in the DynamoDB table named by
`RESET_TOKENS_TABLE_NAME`; the raw token is passed to a delivery hook and is never returned over
HTTP. `POST /auth/reset/confirm` (body `{ "token": "...", "password": "..." }`) consumes the token
once and sets the new password, which invalidates the user's existing sessions.

Reset links are delivered by a pluggable email provider:

- With `EMAIL_FROM_ADDRESS` set, the API sends a message through Amazon SES v2 to the user's stored
  `email` address. `EMAIL_FROM_NAME` optionally sets the display name (the deploy CLI uses
  "Provisionless"). The message links to `${ADMIN_BASE_URL}/reset?token=...`; `ADMIN_BASE_URL`
  defaults to `http://localhost:3001` for local development and is set to the deployed admin URL by
  `provisionless deploy`.
- Without `EMAIL_FROM_ADDRESS`, the API uses a logging provider and prints the reset link, so the
  flow works locally without email setup.

SES starts in the sandbox: both the sender identity and each recipient must be verified, and the
deploy CLI prints verification guidance when it creates the identity. Request production access in
SES before relying on reset emails for real users. Users without an email address cannot receive SES
mail; the API logs a warning in that case.

Admins can also create a link manually with `POST /auth/reset/link` (body `{ "username": "..." }`).
The route requires an admin session, returns `{ "username": "...", "url": "..." }`, and does not send
email, so it works when SES is not configured. Non-admin callers get `403`, unknown usernames get
`404` without creating a token, and the returned link has the same one-hour, single-use behavior as
an emailed link.

### User management

These routes require an admin session (`401` unauthenticated, `403` non-admin):

- `GET /users` returns `{ "users": [...] }` sorted by username.
- `POST /users` creates a user from `{ "username", "password", "email", "firstName", "lastName",
"isAdmin"?, "enabled"? }` and returns `201` with `{ "user": ... }`. `isAdmin` defaults to `false`
  and `enabled` to `true`; duplicate usernames return `409` and invalid fields return `400`.
- `PATCH /users/:username` updates any of `enabled`, `isAdmin`, `email`, `firstName`, or `lastName`
  and returns `{ "user": ... }`. Unknown users return `404`.

Every response uses the public user shape, so password hashes and `passwordChangedAt` are never
returned. Passwords are hashed with the same code used by login and reset; administrators set a
password directly when creating a user.

### Content types and entries

Content schemas are managed by admins:

- `GET /content-types` lists `{ "contentTypes": [...] }` sorted by slug.
- `GET /content-types/:slug` returns `{ "contentType": ... }`.
- `PUT /content-types/:slug` creates or replaces a schema from `{ "name": "...", "fields": [{ "name":
"...", "type": "string" | "boolean", "required"?: true }] }`.
- `DELETE /content-types/:slug` deletes the schema and every entry that belongs to it.

Content entries require a valid session (any role):

- `GET /content/:slug` lists `{ "entries": [...] }`.
- `GET /content/:slug/:id` returns `{ "entry": ... }`.
- `POST /content/:slug` creates an entry from `{ "values": { ... } }` and returns `201`.
- `PUT /content/:slug/:id` replaces an entry's values.
- `DELETE /content/:slug/:id` removes an entry.

Values are validated against the stored schema before write operations: missing required fields,
wrong value types, and unknown fields return `400` with an `errors` array. Unknown content types or
entries return `404`.

### OpenAPI

`GET /openapi.json` returns an OpenAPI 3.0 document describing every route, including request and
response schemas and the session-cookie security scheme (`provisionless_session`). Admin-only routes
are marked as requiring the cookie.

### Example route

`GET /health` returns:

```json
{ "status": "ok" }
```

## AWS Lambda

`npm run build --workspace=@provisionless/api` emits the Lambda handler to `dist/lambda.js`,
exposed as `@provisionless/api/lambda` and created with Hono's
[AWS Lambda adapter](https://hono.dev/docs/getting-started/aws-lambda). It accepts API Gateway
(v1 and v2), Application Load Balancer, and Lambda Function URL events.
