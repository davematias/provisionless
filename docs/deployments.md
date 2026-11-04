# Deployments and resource tags

`provisionless deploy` tags every taggable resource it creates or adopts. The tags identify the
deployment (the app prefix) and mark the resource as Provisionless-managed, so an account can be
searched without relying on a local `.provisionless` file or guessing resource names.

## Tag schema

| Key                     | Value          | Purpose                                            |
| ----------------------- | -------------- | -------------------------------------------------- |
| `provisionless:managed` | `true`         | Marks a resource as managed by Provisionless.      |
| `provisionless:app`     | `<app prefix>` | Identifies the deployment the resource belongs to. |

Tags are sent in the create request where the AWS API supports it. Existing resources are tagged on
every deploy, so resources created by older CLI versions, or adopted from an earlier run, are brought
onto the same schema without being recreated.

## Taggable resources

| Service     | Resources                                                                |
| ----------- | ------------------------------------------------------------------------ |
| S3          | Media bucket and admin assets bucket                                     |
| DynamoDB    | Users, reset tokens, content types, content entries, and admin tag cache |
| SQS         | Revalidation FIFO queue                                                  |
| IAM         | API and admin Lambda execution roles                                     |
| Lambda      | API, admin SSR, image optimization, and revalidation functions           |
| CloudFront  | Admin distribution and redirect function                                 |
| API Gateway | HTTP API, `$default` stage, and custom domain                            |
| ACM         | Admin and API certificates, including reused certificates                |
| SES         | Verified sender identity                                                 |

## Resources AWS does not allow tagging

These are created or adopted by `deploy` but cannot carry the tags. They are still managed by name
and relationship, and discovery reaches them through their tagged parent.

- **CloudFront origin access controls** — CloudFront tags distributions and functions, not OACs.
- **Lambda Function URLs and event source mappings** — configuration subresources with no tag API.
- **API Gateway integrations, routes, and API mappings** — reached through the tagged API.
- **S3 objects and bucket policies** — the buckets are tagged; uploaded objects and policy documents
  are not infrastructure resources.
- **IAM inline policies and attached managed policies** — the roles are tagged; policy documents are
  not.
- **Route 53 records** — records cannot be tagged, and the hosted zone is pre-existing and user-owned.
- **CloudWatch log groups** — created implicitly by Lambda, not provisioned by `deploy`.
- **CloudFront managed cache and origin request policies** — AWS-managed policy IDs, not created by
  `deploy`.

## Discovery

The tagged resources are the discovery anchors. Querying `provisionless:managed=true` (optionally
with `provisionless:app=<prefix>`) across regions returns the resources that make up each deployment.
Non-taggable children are then found through their parent: for example, a CloudFront distribution
leads to its origin access controls and redirect function, an HTTP API leads to its integrations,
routes, stage, and domain mappings, and a bucket leads to its objects.

## Required permissions

The caller needs the tagging action for each service it provisions, in addition to the corresponding
create/read permissions:

- `s3:PutBucketTagging`
- `dynamodb:TagResource`
- `sqs:TagQueue`
- `iam:TagRole`
- `lambda:TagResource`
- `cloudfront:TagResource`
- `apigateway:TagResource`
- `acm:AddTagsToCertificate`
- `ses:TagResource`
