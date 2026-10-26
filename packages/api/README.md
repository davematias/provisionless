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

The auth routes establish the session cookie that the admin site uses. When the admin app is served
from a different origin, set:

- `AUTH_ALLOW_ORIGINS` — comma-separated origins allowed to call the API with credentials (for example
  `http://localhost:3000` in local development). Without it no CORS headers are emitted.
- `AUTH_COOKIE_SAMESITE=None` — required only when admin and API are on genuinely different sites;
  the cookie is then always `Secure`. Leave unset (`Lax`) for same-site setups like localhost.
- `AUTH_COOKIE_SECURE=true` — mark cookies `Secure` in local development when using `Lax`.

`provisionless deploy` sets these automatically for the deployed admin and API URLs.

### Password reset

Requesting a reset creates a single-use, expiring token for the user and returns the same response
whether or not the account exists, so it never reveals whether a username is registered. Only a hash
of the token is stored, in the DynamoDB table named by `RESET_TOKENS_TABLE_NAME`; the raw token is
passed to a delivery hook and is never returned over HTTP. Confirming a reset consumes the token once
and sets the new password, which invalidates the user's existing sessions.

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

Admins can also create a link manually without sending email. The request requires an admin session,
returns the username and URL, responds `403` for non-admins, and `404` for unknown usernames without
creating a token. The returned link has the same one-hour, single-use behavior as an emailed link.

### User management

User management is admin-only (`401` unauthenticated, `403` non-admin). Admins can list users,
create them with a password, and update profile fields, `isAdmin`, and `enabled`. Duplicate
usernames are rejected and unknown users return `404`.

Every response uses the public user shape, so password hashes and `passwordChangedAt` are never
returned. Passwords are hashed with the same code used by login and reset; administrators set a
password directly when creating a user.

### Content types and entries

Content schemas are managed by admins; entries require a valid session with any role. Deleting a
schema deletes every entry that belongs to it.

Values are validated against the stored schema before write operations: missing required fields,
wrong value types, and unknown fields return `400` with an `errors` array. Unknown content types or
entries return `404`.

### API reference

The [OpenAPI document](../../openapi.json) is the single reference for every route, parameter, and
request and response shape, including the session-cookie security scheme
(`provisionless_session`); `GET /openapi.json` serves the same document at runtime. Regenerate and
verify it after changing routes:

```bash
npm run openapi:generate
npm run openapi:check
```

## AWS Lambda

`npm run build --workspace=@provisionless/api` emits the Lambda handler to `dist/lambda.js`,
exposed as `@provisionless/api/lambda` and created with Hono's
[AWS Lambda adapter](https://hono.dev/docs/getting-started/aws-lambda). It accepts API Gateway
(v1 and v2), Application Load Balancer, and Lambda Function URL events.
