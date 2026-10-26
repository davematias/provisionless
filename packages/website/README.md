# @provisionless/website

The Provisionless marketing website, built with [Next.js](https://nextjs.org) (App Router) and
styled with the shared [`@provisionless/design-system`](../design-system) package.

## Local development

From the repository root:

```bash
npm run dev --workspace=@provisionless/website
```

The site runs at http://localhost:3000.

## Security headers

`next.config.ts` sends a baseline set of browser security headers on every route: a
Content-Security-Policy, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` (with
`frame-ancestors` in the policy), `Strict-Transport-Security`, and `Permissions-Policy`.

The policy allows inline scripts and styles because the App Router bootstraps with inline scripts and
the design system theme script runs before hydration; a nonce-based policy would force every page to
render dynamically. Development adds the eval and websocket sources Next.js needs. The definitions
live in `src/lib/security-headers.ts` and are covered by unit tests.

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
