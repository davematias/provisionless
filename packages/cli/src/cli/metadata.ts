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
      "provisionless deploy --admin-domain admin.example.com --api-domain api.example.com --hosted-zone Z0123456789",
      "provisionless deploy --dry-run",
    ],
    prerequisites: [
      "AWS credentials allowed to manage IAM, Lambda, API Gateway, S3, DynamoDB, SQS, and CloudFront",
      "Run from inside the Provisionless repository",
      "For custom domains, a Route 53 hosted zone (to create DNS records automatically) or the ability to add DNS records yourself",
    ],
    resources: [
      "API: IAM role, Lambda function, API Gateway HTTP API, and a DynamoDB users table",
      "Admin: S3 assets bucket, DynamoDB tag cache, FIFO SQS queue, three Lambda functions, Lambda Function URLs, a CloudFront distribution, OACs, and an IAM role",
      "Media: an S3 media bucket",
    ],
  },
  undeploy: {
    summary:
      "Delete the AWS resources that deploy created for an app prefix, optionally keeping data.",
    examples: [
      "provisionless undeploy",
      "provisionless undeploy --prefix acme --keep-data",
      "provisionless undeploy --prefix acme --no-keep-data --yes",
      "provisionless undeploy --dry-run",
    ],
    prerequisites: [
      "AWS credentials for the account and region that were deployed",
      "The app prefix (read from .provisionless, or pass --prefix)",
    ],
    resources: [
      "API: Lambda function, API Gateway HTTP API, IAM role, and the users table (unless keeping data)",
      "Admin: CloudFront distribution, Lambdas, Function URLs, SQS queue, OACs, IAM role, tag cache and assets bucket (unless keeping data)",
      "Media: the S3 media bucket (unless keeping data)",
    ],
  },
} satisfies Record<string, CommandHelp>;

export function commandHelp(name: string): CommandHelp | undefined {
  return (COMMAND_HELP as Record<string, CommandHelp>)[name];
}
