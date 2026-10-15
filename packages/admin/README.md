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

## Route protection

Admin pages require a session. Because the admin and API are served from different sites and the
session cookie is `httpOnly` on the API origin, the admin server cannot read it, so the guard runs in
the browser: `AuthGuard` (in `src/components/auth-guard.tsx`, wrapping the root layout) calls
`GET /auth/me` with `credentials: "include"` and only renders the page once the API confirms the
session. Unauthenticated visitors are sent to `/login?from=<requested path>`, and the login page
returns them there after signing in; already-authenticated visitors to `/login` are sent to the
requested page (or the admin home). The public routes are the allowlist in
`src/lib/session.ts` (`PUBLIC_PATHS`): `/login` and `/reset-password`.

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
