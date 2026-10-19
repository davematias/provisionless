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

## Password reset

`/forgot` collects a username and posts it to `${NEXT_PUBLIC_API_URL}/auth/reset/request`. It always
shows the same confirmation, whether or not the account exists, so the page does not reveal which
usernames are registered.

`/reset?token=...` collects a new password and confirmation, posts them to
`${NEXT_PUBLIC_API_URL}/auth/reset/confirm`, and on success sends the visitor to
`/login?reset=success`, where the login page shows a confirmation. Invalid or expired tokens get a
clear error with a link back to `/forgot`.

### Manual reset links

`/reset-links` (available to administrators in the sidebar) generates a one-time link without
sending email. It posts the username to `${NEXT_PUBLIC_API_URL}/auth/reset/link` and shows the
returned URL with a copy button. Use it when SES is not configured or a user cannot receive mail;
share the link over a trusted channel. The link expires after one hour and works once.

## Route protection

Admin pages require a session. Because the admin and API are served from different sites and the
session cookie is `httpOnly` on the API origin, the admin server cannot read it, so the guard runs in
the browser: `AuthGuard` (in `src/components/auth-guard.tsx`, wrapping the root layout) calls
`GET /auth/me` with `credentials: "include"` and only renders the page once the API confirms the
session. Unauthenticated visitors are sent to `/login?from=<requested path>`, and the login page
returns them there after signing in; already-authenticated visitors to `/login` are sent to the
requested page (or the admin home). The public routes are the allowlist in
`src/lib/session.ts` (`PUBLIC_PATHS`): `/login`, `/forgot`, and `/reset`.

## Design system

The admin UI is built on the shared [`@provisionless/design-system`](../design-system)
package, which provides [Tailwind CSS](https://tailwindcss.com) v4 tokens and
[shadcn/ui](https://ui.shadcn.com) (New York style) components. The package ships its
sources; the admin imports them directly and Next transpiles them (`transpilePackages` in
`next.config.ts`).

Tailwind configuration is CSS-first: `src/app/globals.css` imports Tailwind and the design
system styles, and the design tokens live as CSS variables in
`packages/design-system/src/styles.css` (mapped onto utilities through `@theme`). Semantic
colors (`primary`, `secondary`, `destructive`, `muted`, `background`, `foreground`, `border`,
`ring`, and more) plus the typography, spacing, radius and shadow scales are defined there.

Dark mode is class-based (`.dark` on `<html>`), follows the system preference by default, and
can be toggled manually with the `ThemeToggle` in the admin shell.

Add new shadcn/ui components to the design system package; `components.json` and the `@/*`
TypeScript path alias live there. The UI primitives are in
`packages/design-system/src/components/ui`, and the `cn()` helper is in
`packages/design-system/src/lib/utils.ts`.

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
