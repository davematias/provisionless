# @provisionless/website

The Provisionless marketing website, built with [Next.js](https://nextjs.org) (App Router) and
styled with the shared [`@provisionless/design-system`](../design-system) package.

## Local development

From the repository root:

```bash
npm run dev --workspace=@provisionless/website
```

The site runs at http://localhost:3000.

## Configuration

| Variable               | Default                 | Purpose                                          |
| ---------------------- | ----------------------- | ------------------------------------------------ |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Canonical site URL, used for metadata and links. |

Set it at build time so absolute URLs and social metadata point at the deployed domain:

```bash
NEXT_PUBLIC_SITE_URL=https://provisionless.dev npm run build --workspace=@provisionless/website
```

## Build

```bash
npm run build --workspace=@provisionless/website
```

## AWS Lambda deployment

Deployment of the website is **not** managed by the `provisionless` CLI; it is done separately
(manually or from CI) so the marketing site can ship independently of the API and admin.

The site is packaged for Lambda with [OpenNext](https://opennext.js.org/aws):

```bash
NEXT_PUBLIC_SITE_URL=https://provisionless.dev npm run build:lambda --workspace=@provisionless/website
```

This produces `.open-next/` (server functions and static assets) which can be deployed behind a
CloudFront distribution backed by the OpenNext Lambda function and an S3 bucket for the static
assets — the same shape the CLI uses for the admin site, but managed by the website's own
infrastructure.

### Domain configuration

Pass the deployment domain through the `NEXT_PUBLIC_SITE_URL` build variable above, and configure
your infrastructure (CloudFront alternate domain name + ACM certificate) with the same domain. The
two must match so canonical URLs resolve to the deployed site.
