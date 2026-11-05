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
| SNS         | Alarm notification topic                                                 |
| CloudWatch  | Lambda log groups and alarms                                             |

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
- **CloudFront managed cache and origin request policies** — AWS-managed policy IDs, not created by
  `deploy`.

## Lambda log retention

`deploy` creates the `/aws/lambda/<function>` log group for every Lambda it provisions and applies a
retention period. The default is 30 days; set `--log-retention <days>` on deploy to choose another
value. The choice is saved in `.provisionless` and reused on later deploys. CloudWatch Logs only
accepts specific retention values (1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731,
1096, 1827, 2192, 2557, 2922, 3288, or 3653 days), so other values are rejected.

Longer retention keeps more history for debugging and audits; shorter retention lowers CloudWatch
Logs storage cost. `undeploy` **keeps the log groups by default** because logs can be important for
troubleshooting; pass `--delete-logs` to remove only the four log groups for the deployment's Lambda
functions. Unrelated log groups in the account are never touched.

## Alarms and notifications

`deploy` creates an SNS topic named `<prefix>-alarms` and one alarm for each failure mode:

| Alarm                               | Metric and threshold                                                      |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `<prefix>-api-5xx`                  | `AWS/ApiGateway` `5XXError` sum >= 1 over 5 minutes.                      |
| `<prefix>-lambda-errors-<label>`    | `AWS/Lambda` `Errors` sum >= 1 over 5 minutes, per function.              |
| `<prefix>-lambda-throttles-<label>` | `AWS/Lambda` `Throttles` sum >= 1 over 5 minutes, per function.           |
| `<prefix>-revalidation-queue-age`   | `AWS/SQS` `ApproximateAgeOfOldestMessage` maximum >= 300 seconds.         |
| `<prefix>-log-ingestion`            | `AWS/Logs` `IncomingBytes` sum >= 1 GiB per day across the Lambda groups. |

The function labels are `api`, `admin-server`, `admin-image`, and `admin-revalidation`. Alarms use
`notBreaching` for missing data so quiet deployment windows do not create false alarms.

Pass `--alarm-email <address>` to subscribe an email address. SNS sends a confirmation email; no
notifications are delivered until the link in that email is accepted. Without the flag the topic and
alarms still exist but have no subscriber. Redeploying updates the topic, subscription, and alarms in
place without duplicating them.

To change a threshold, edit the alarm in the CloudWatch console; a later deploy reapplies these
documented defaults. To silence notifications without deleting the alarms, unsubscribe in SNS.
`undeploy` deletes the deployment alarms and topic, including subscriptions, and leaves other
prefixes untouched.

CloudWatch alarms incur a small monthly charge. For spend protection beyond these metrics, create an
AWS Budget with an alert in `us-east-1`, since Budgets is a global service and can cover services the
CLI does not provision.

## Discovering deployments

Two read-only commands use the tags to find and inspect deployments without a local `.provisionless`
file:

```bash
provisionless list [--region <regions>] [--json]
provisionless status --prefix <prefix> [--region <region>] [--json] [--no-check]
```

`list` searches every enabled region by default (or the comma-separated `--region` list), groups
tagged resources by `provisionless:app`, and prints the prefix, region, admin URL, API URL, and
health. `status` shows the tagged resource inventory, URLs, and health for one deployment; it also
probes the admin URL and API `/openapi.json` unless `--no-check` is passed.

Health is `healthy` when the tagged CloudFront distribution is deployed and the HTTP API has a
`$default` stage, `deploying` while CloudFront is updating, and `degraded` when an anchor is missing
or a live check fails. `unknown` means neither a distribution nor an API was tagged for the prefix.

Global resources (CloudFront, IAM roles, and S3 buckets) are tagged in `us-east-1`; `status` includes
that region when a single `--region` is requested so those resources are still found. If the same
prefix is deployed in multiple regions, `list` shows one row per region and `status` requires
`--region`.

### Required read permissions

- `tag:GetResources`
- `account:ListRegions` (skipped when `--region` is passed)
- `cloudfront:GetDistribution`
- `apigateway:GetApi`, `apigateway:GetStages`, `apigateway:GetDomainNames`,
  `apigateway:GetApiMappings`

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
- `sns:TagResource`
- `cloudwatch:TagResource`
- `logs:CreateLogGroup`, `logs:PutRetentionPolicy`, `logs:TagResource`, and `logs:DeleteLogGroup`

Alarm management additionally needs `sns:CreateTopic`, `sns:Subscribe`,
`sns:ListSubscriptionsByTopic`, `sns:DeleteTopic`, `cloudwatch:PutMetricAlarm`,
`cloudwatch:DescribeAlarms`, and `cloudwatch:DeleteAlarms`. `cloudwatch:PutMetricAlarm` with tags also
requires `cloudwatch:TagResource`.
