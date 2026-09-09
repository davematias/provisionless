# Provisionless

**A serverless headless CMS that lives entirely in your AWS account — Lambda on the compute side, DynamoDB on the data side. Nothing to provision, nothing to babysit.**

The name is a double meaning: *serverless* (no infrastructure to provision) and DynamoDB's *on-demand* capacity mode (no throughput to provision). Pay per request, scale to zero, scale to millions.

> Status: design phase. This README is the blueprint; there is no implementation yet.

## Why

Webiny is currently the only actively maintained open-source CMS that is truly "AWS serverless native" (Lambda + DynamoDB + S3). Its footprint is large and dated in places. There is room for a lean, modern, TypeScript-first alternative:

- Zero to low running cost: free-tier friendly, on-demand billing only.
- One `npx` deploy, no servers, no containers, no Postgres to patch.
- Headless-first: clean REST + GraphQL content APIs, nothing about rendering.
- Read path fast enough to serve content directly (single-table DynamoDB, optional CloudFront cache), no middlebox servers.

## Goals

- Self-hostable headless CMS deployed to the user's own AWS account via IaC.
- Content modeling UI (define models, fields, validations) + entry editor UI.
- Draft/live versioning, locales, scheduled publishing (TTL + EventBridge).
- Assets to S3 behind CloudFront; content in DynamoDB single table.
- REST + GraphQL read APIs with API key auth (public) and IAM/Cognito auth (admin).
- Webhooks on publish, image transforms via Lambda@Edge / Cloud Functions.
- Local dev against DynamoDB Local + `serverless-offline` equivalent.

## Non-goals (for now)

- Website/visual page builder (see Plasmic/Webiny).
- Multi-cloud (GCP/Azure). AWS-only until the core is solid.
- Realtime collaboration.

## Architecture

```
                    ┌──────────────────────────────────────────────┐
                    │                 AWS account                  │
 Admin UI (React)   │                                              │
 ┌────────────┐     │  ┌───────────────┐      ┌─────────────────┐ │
 │ CloudFront ├─────┼─▶│    API GW     │◀─────┤  Content API    │ │
 ├────────────┤     │  │ (HTTP APIs)   │      │  (Lambda)       │ │
 │ Editor UI  │     │  └──────┬────────┘      └───────┬─────────┤ │
 │ on S3      │     │         │ Cognito auth          │         │ │
 └────────────┘     │  ┌──────▼────────┐      ┌───────▼─────────┤ │
                    │  │  Admin API    ├─────▶│    DynamoDB     │ │
 Assets (S3)        │  │  (Lambda)     │      │  single table   │ │
 ┌────────────┐     │  └───────────────┘      └───────┬─────────┤ │
 │ CloudFront ├─────┼────────────────────────────────┼─────────┤ │
 │ + Lambda@E │     │  EventBridge (schedules,       │streams  │ │
 └────────────┘     │  webhooks) ◀───────────────────┴─────────┘ │
                    └──────────────────────────────────────────────┘
```

## Core concepts

| Concept    | Description                                                             |
|------------|-------------------------------------------------------------------------|
| Model      | Content type definition (fields, validations, layouts). Schemaless — models are data, not code. |
| Entry      | An instance of a model; has draft + live versions.                      |
| Asset      | File in S3, metadata in DynamoDB, CDN URL on the edge.                  |
| Locale     | Entry versions per language.                                            |
| API key    | Scoped, read-only public keys (publish-only, per-model restrictions).   |

## Data model (single table)

One table, `provisionless`, partition key `PK`, sort key `SK`, GSI on `GSI1PK/GSI1SK`, TTL attribute for scheduled jobs.

```
PK                     SK                      purpose
PROJ#<projectId>       MODEL#<modelId>         content model definition
ENTRY#<entryId>        DRAFT#<locale>          draft version
ENTRY#<entryId>        LIVE#<locale>           published version
ENTRY#<entryId>        META                    status, model ref, timestamps
PROJ#<projectId>       TYPE#ENTRY#MODEL#<id>…  GSI: list entries by model
APIKEY#<hash>          SECRET                  hashed API keys
```

## Repo layout (planned monorepo)

```
provisionless/
├── packages/
│   ├── schema/        # model/field/validation types + zod schemas
│   ├── db/            # DynamoDB access layer, single-table mapping
│   ├── api/           # Hono handler app (runs in Lambda via lambda-middy/bundler)
│   ├── functions/     # Lambda entrypoints, EventBridge consumers
│   ├── ui/            # React admin: model builder + entry editor (TanStack Query/Router)
│   ├── sdk/           # TS client for the public content API
│   └── cli/           # `provisionless deploy|dev|seed` — wraps the IaC stack
├── infra/             # SST v3 (or CDK) stack: API GW, Lambdas, DynamoDB, S3, CloudFront, Cognito
├── docs/              # website (Astro)
└── examples/          # blog, marketing-site consumers
```

## API sketch

```
POST   /rest/{model}                 # create entry draft   (API key with write or admin token)
GET    /rest/{model}?filters=…       # list live entries     (public API key)
GET    /rest/{model}/{id}?locale=de  # read entry
POST   /graphql                      # introspectable content graph (live stage)
POST   /admin/…                      # models, publishing, assets, keys (Cognito)
```

## Tech stack (proposed)

- TypeScript everywhere, pnpm + Turborepo
- Hono for handlers (deployable to Lambda and to DynamoDB Local in dev)
- @aws-sdk/lib-dynamodb, no ORM — explicit single-table design
- SST v3 for deployment (Serverless Framework as fallback option)
- React 19 + Radix + Tailwind admin UI; Plate for rich text
- Vitest + DynamoDB Local for integration tests; no mocks of the data plane

## Roadmap

- **v0.1 — walking skeleton**: SST stack (API GW + Lambda + DynamoDB), CLI CRUD on models/entries, no UI.
- **v0.2 — read APIs**: REST + GraphQL, API keys, draft/live split, locales.
- **v0.3 — admin UI**: model builder, entry editor, deploy-time hosting on S3+CloudFront.
- **v0.4 — assets**: S3 upload flow, signed uploads, image transforms at the edge.
- **v0.5 — publishing**: webhooks, scheduled publish, preview links.
- **v0.6 — hardening**: multi-project, rate limits, cost guardrails, docs site.

## Prior art

[Webiny](https://github.com/webiny/webiny-js) (the inspiration to do it leaner), [Abu CMS](https://github.com/kdcio/abu), jamstack-cms (both dormant). Directus/Payload/Strapi are excellent but require SQL servers — the opposite of this premise.

## License

MIT (under consideration: Apache-2.0 if the ecosystem play gets serious).
