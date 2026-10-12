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
