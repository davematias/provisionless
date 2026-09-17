# @provisionless/api

The Provisionless backend/content API, built with [Hono](https://hono.dev).

## Local development

From the repository root:

```bash
npm run dev --workspace=@provisionless/api
```

The server listens on http://localhost:3000 (override with `PORT`). It runs the TypeScript
sources directly using Node's built-in type stripping, so no build step is required.

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
