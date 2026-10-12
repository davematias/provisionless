# @provisionless/admin

The Provisionless admin website, built with [Next.js](https://nextjs.org) (App Router).

## Local development

From the repository root:

```bash
npm run dev --workspace=@provisionless/admin
```

The app runs at http://localhost:3000.

## Login

`/login` posts the credentials to the API (`${NEXT_PUBLIC_API_URL}/auth/login`) with
`credentials: "include"` and stores the session cookie returned by the API; on success it redirects to
the admin home, on failure it shows a generic error. Point the build/dev server at the API with:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001 npm run dev --workspace=@provisionless/admin
PORT=3001 AUTH_ALLOW_ORIGINS=http://localhost:3000 npm run dev --workspace=@provisionless/api
```

`npm run build:lambda` reads `NEXT_PUBLIC_API_URL` as well; the deploy CLI passes the deployed API URL
into the admin build automatically, and configures the API to accept the deployed admin origin.

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
