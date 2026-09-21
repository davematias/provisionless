# provisionless

Deploy the Provisionless API and admin website to AWS with a single command.

## Usage

Deploy without installing anything globally:

```bash
npx provisionless deploy
```

Options:

- `--region <region>` — AWS region to deploy into (defaults to `AWS_REGION` or `us-east-1`).
- `--dry-run` — report what would be created or updated without changing AWS.

`deploy` bundles the API, builds the admin website with
[OpenNext](https://opennext.js.org/aws), and provisions:

- **API** — a Lambda function behind an API Gateway HTTP API.
- **Admin** — an S3 bucket (static assets and incremental cache), a DynamoDB tag cache, a
  FIFO SQS revalidation queue, three Lambda functions (SSR, image optimization, and
  revalidation), and a CloudFront distribution in front of the Lambda and S3 origins.

It uses the standard AWS credential chain. The caller must be allowed to manage IAM, Lambda,
API Gateway, S3, DynamoDB, SQS, and CloudFront. Running it again updates the existing
resources in place.

## Local development

Run the CLI from source without building or publishing:

```bash
node --experimental-strip-types packages/cli/src/index.ts deploy --dry-run
```

Or build and run the compiled entry point:

```bash
npm run build --workspace=provisionless
node packages/cli/dist/index.js deploy
```

## Development

```bash
npm run build --workspace=provisionless
npm test --workspace=provisionless
```
