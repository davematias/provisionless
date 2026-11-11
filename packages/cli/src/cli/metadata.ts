export interface CommandHelp {
  summary: string;
  examples: string[];
  prerequisites: string[];
  resources: string[];
}

export const CLI_NOTE =
  "Provisionless provisions AWS resources with the AWS SDK for JavaScript v3. It does not use CloudFormation or any other IaC framework.";

export const COMMAND_HELP = {
  deploy: {
    summary:
      "Provision the API, admin website, media bucket, and users table on AWS, then seed a test user.",
    examples: [
      "provisionless deploy",
      "provisionless deploy --region eu-west-1 --prefix acme",
      "provisionless deploy --prefix acme --media-bucket uploads",
      "provisionless deploy --email-from no-reply@example.com",
      "provisionless deploy --alarm-email ops@example.com",
      "provisionless deploy --admin-domain admin.example.com --api-domain api.example.com --hosted-zone Z0123456789",
      "provisionless deploy --no-domains",
      "provisionless deploy --log-retention 14",
      "provisionless deploy --api-log-level warn",
      "provisionless deploy --dry-run",
    ],
    prerequisites: [
      "AWS credentials allowed to manage IAM, Lambda, API Gateway, S3, DynamoDB, SQS, SNS, CloudWatch, CloudFront, ACM, Route 53, and SES",
      "Run from inside the Provisionless repository",
      "For custom domains, a Route 53 hosted zone (to create DNS records automatically) or the ability to add DNS records yourself",
      "For password reset emails, a verified SES sending address (the deploy CLI creates the identity and prints verification guidance)",
    ],
    resources: [
      "API: IAM role, Lambda function, API Gateway HTTP API with JSON access logs, and DynamoDB users, reset-tokens, content-types, and content-entries tables",
      "Email: an SES sending identity for the configured --email-from address, with send permission on the API role",
      "Admin: S3 assets bucket, DynamoDB tag cache, FIFO revalidation queue and dead-letter queue, three Lambda functions, Lambda Function URLs, a CloudFront distribution, OACs, and an IAM role",
      "Media: an S3 media bucket",
      "Logs: a CloudWatch log group for every Lambda function with the configured retention period, and a 14-day API Gateway access log group",
      "Alarms: an SNS notification topic, CloudWatch alarms for API 5xx responses, Lambda errors and throttles, revalidation queue age and dead-letter depth, and daily log ingestion, plus a per-deployment CloudWatch dashboard; an optional --alarm-email subscription requires inbox confirmation",
      "Domains: an ACM certificate per configured domain (us-east-1 for admin, the deployment region for the API), with DNS validation records in Route 53 when a hosted zone is set; the admin domain is aliased to the CloudFront distribution (with an apex/www redirect) and the API domain to an API Gateway custom domain, each with alias DNS records when a hosted zone is set",
    ],
  },
  undeploy: {
    summary:
      "Delete the AWS resources that deploy created for an app prefix, optionally keeping data.",
    examples: [
      "provisionless undeploy",
      "provisionless undeploy --prefix acme --keep-data",
      "provisionless undeploy --prefix acme --no-keep-data --yes",
      "provisionless undeploy --prefix acme --delete-logs",
      "provisionless undeploy --dry-run",
    ],
    prerequisites: [
      "AWS credentials for the account and region that were deployed",
      "The app prefix (read from .provisionless, or pass --prefix)",
    ],
    resources: [
      "API: Lambda function, API Gateway HTTP API, IAM role, and the users, reset-tokens, content-types, and content-entries tables (unless keeping data)",
      "Admin: CloudFront distribution, Lambdas, Function URLs, revalidation and dead-letter queues, OACs, IAM role, tag cache and assets bucket (unless keeping data)",
      "Media: the S3 media bucket (unless keeping data)",
      "Domains: API Gateway custom domain and mappings, Route 53 alias and ACM-validation records for the managed domains, the CloudFront redirect function, and the ACM certificates recorded in .provisionless",
      "Logs: Lambda log groups are kept by default; with --delete-logs they are deleted. The API Gateway access log group is always deleted",
      "Alarms: deletes the deployment's CloudWatch alarms, SNS notification topic (including any email subscription), and CloudWatch dashboard",
    ],
  },
  list: {
    summary: "List Provisionless deployments found across the account's enabled regions.",
    examples: [
      "provisionless list",
      "provisionless list --region eu-west-1",
      "provisionless list --region us-east-1,eu-west-1 --json",
    ],
    prerequisites: [
      "AWS credentials allowed to read resource tags, CloudFront distributions, and API Gateway APIs",
      "Resources tagged by a previous provisionless deploy",
    ],
    resources: [
      "Read-only: calls the Resource Groups Tagging API, CloudFront, and API Gateway; changes nothing",
    ],
  },
  status: {
    summary: "Show the resources, URLs, and health of one Provisionless deployment.",
    examples: [
      "provisionless status --prefix acme",
      "provisionless status --prefix acme --region eu-west-1",
      "provisionless status --prefix acme --json",
      "provisionless status --prefix acme --no-check",
    ],
    prerequisites: [
      "AWS credentials allowed to read resource tags, CloudFront distributions, and API Gateway APIs",
      "The app prefix, or run provisionless list first",
    ],
    resources: [
      "Read-only: lists tagged resources and optionally probes the admin URL and API /openapi.json; changes nothing",
    ],
  },
} satisfies Record<string, CommandHelp>;

export function commandHelp(name: string): CommandHelp | undefined {
  return (COMMAND_HELP as Record<string, CommandHelp>)[name];
}
