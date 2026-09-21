# provisionless

Deploy the Provisionless API and admin website to AWS with a single command.

## Usage

Deploy without installing anything globally:

```bash
npx provisionless deploy
```

Options:

- `--region <region>` — AWS region to deploy into (defaults to `AWS_REGION` or `us-east-1`).
- `--prefix <prefix>` — app prefix used to name resources; prompted when omitted.
- `--media-bucket <name>` — media bucket name (prompted when omitted); the app prefix is prepended.
- `--test-user-username <username>` / `--test-user-password <password>` — supply the test user's
  credentials non-interactively (prompted when omitted).
- `--dry-run` — report what would be created or updated without changing AWS.

### App prefix and saved config

Deployments are namespaced by an app prefix. When `--prefix` is not passed, the CLI prompts for one
and saves it (with other deployment settings) to a local `.provisionless` file in the repository
root. On later runs it offers to reuse the saved prefix. `.provisionless` is gitignored and must
never be committed.

### Media bucket

The CLI provisions an S3 bucket for uploaded media (images, video, and so on) in the deployment's
region. It prompts for the bucket name and prepends the app prefix (for example, prefix `demo` and
name `media` create `demo-media`). The resolved name is saved in `.provisionless` and passed to the
deployed API as `MEDIA_BUCKET_NAME`. Re-running deploy reuses the existing bucket.

### Test user

After a successful deploy the CLI asks for a username and password and seeds exactly one admin test
user into the deployed users table, then prints the credentials so you can log in immediately.

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
