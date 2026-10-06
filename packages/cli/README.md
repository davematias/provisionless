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
- `--admin-domain <domain>` / `--api-domain <domain>` — custom domains for the admin site and API
  (prompted when omitted; leave blank to deploy without a custom domain).
- `--hosted-zone <id-or-name>` — Route 53 hosted zone used to create DNS records automatically;
  without it the CLI prints the records to add yourself.
- `--no-domains` — skip custom-domain configuration entirely and deploy without domains; useful for
  non-interactive runs (scripts and CI) when you do not want custom domains.
- `--test-user-username <username>` / `--test-user-password <password>` — supply the test user's
  credentials non-interactively (prompted when omitted).
- `--dry-run` — report what would be created or updated without changing AWS.

### Undeploy

Remove everything a deployment created:

```bash
npx provisionless undeploy
```

The CLI reads the app prefix from `.provisionless` (or `--prefix`) and asks whether to keep data
(S3 objects and DynamoDB tables) before deleting anything. Use `--keep-data` / `--no-keep-data` to
answer up front, `--yes` to skip the confirmation, and `--dry-run` to see what would be removed.

### Help

```bash
npx provisionless help
npx provisionless help deploy
npx provisionless help --json
```

Every command documents its purpose, options, examples, prerequisites, and the AWS resources it
manages. `--json` prints the same information machine-readably for agents and tooling.

### Region

The region comes from `--region`, otherwise from the saved `.provisionless` config, otherwise
`AWS_REGION`, otherwise an interactive prompt. The resolved region is saved for later runs.

### Custom domains

Set `--admin-domain` and/or `--api-domain` to serve the admin site and API on your own domains. If a
`--hosted-zone` is given, DNS records are created in Route 53 automatically; otherwise the CLI prints
the records to add. The domains and hosted zone are saved in `.provisionless` and offered for reuse.
Leave the prompts blank to deploy without custom domains.

For the admin site, the domain is attached to the CloudFront distribution together with its certificate.
When the admin domain is an apex (for example `example.com`) its `www` variant is attached too (and the
other way around for a `www` domain): both names are aliased to the distribution, and requests for the
non-canonical name are redirected (HTTP 301) to the configured admin domain. Re-running deploy updates
the distribution and DNS idempotently. If the certificate is not issued yet, the deploy
continues with the default CloudFront domain and prints guidance; re-run deploy once the certificate is
issued to attach the domain.

For the API domain, the CLI creates an API Gateway regional custom domain with the certificate from the
deployment region and maps it to the API's default stage, then reports `https://<api-domain>` as the API
URL. A matching custom domain and mapping are reused, and a changed certificate is updated in place.
Unlike the admin domain, the API domain is served alone (no apex/www pairing). If the API certificate is
not issued yet, the deploy keeps the generated `execute-api` URL and prints guidance.

### Certificates

For each configured domain the CLI requests an ACM certificate (or reuses an existing one for the
same domains): the admin certificate is created in `us-east-1`, which CloudFront requires, and the API
certificate in the deployment region. The admin certificate also covers the `www`/apex sibling that is
aliased to the distribution. When a `--hosted-zone` is configured, the CLI creates the DNS
validation records in Route 53 and waits for the certificate to be issued. Without one, it prints the
CNAME records to add and tells you how to continue once they are validated. Certificate ARNs are
saved in `.provisionless` so later deploy steps can reference them.

Pass `--no-domains` to skip custom-domain configuration entirely, so a deploy runs unattended without
prompting. Saved domains are ignored for that run but are left in `.provisionless`, so a later deploy
without the flag can still reuse them.

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
