# @provisionless/admin

The Provisionless admin website, built with [Next.js](https://nextjs.org) (App Router).

## Local development

From the repository root:

```bash
npm run dev --workspace=@provisionless/admin
```

The app runs at http://localhost:3000.

## Build

```bash
npm run build --workspace=@provisionless/admin
```

## AWS Lambda

The app is packaged for Lambda with [OpenNext](https://opennext.js.org/aws):

```bash
npm run build:lambda --workspace=@provisionless/admin
```

This produces `.open-next/` (server functions and static assets) that the Provisionless deploy CLI
packages for AWS.
