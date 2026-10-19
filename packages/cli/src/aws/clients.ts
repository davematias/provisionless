import { ACMClient } from "@aws-sdk/client-acm";
import { ApiGatewayV2Client } from "@aws-sdk/client-apigatewayv2";
import { CloudFrontClient } from "@aws-sdk/client-cloudfront";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { IAMClient } from "@aws-sdk/client-iam";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { Route53Client } from "@aws-sdk/client-route-53";
import { S3Client } from "@aws-sdk/client-s3";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { SQSClient } from "@aws-sdk/client-sqs";
import { STSClient } from "@aws-sdk/client-sts";

export interface AwsClients {
  sts: STSClient;
  iam: IAMClient;
  lambda: LambdaClient;
  apiGateway: ApiGatewayV2Client;
  s3: S3Client;
  sqs: SQSClient;
  ses: SESv2Client;
  dynamodb: DynamoDBClient;
  cloudfront: CloudFrontClient;
  acm: ACMClient;
  acmUsEast1: ACMClient;
  route53: Route53Client;
}

export function createAwsClients(region: string): AwsClients {
  return {
    sts: new STSClient({ region }),
    iam: new IAMClient({ region }),
    lambda: new LambdaClient({ region }),
    apiGateway: new ApiGatewayV2Client({ region }),
    s3: new S3Client({ region }),
    sqs: new SQSClient({ region }),
    ses: new SESv2Client({ region }),
    dynamodb: new DynamoDBClient({ region }),
    cloudfront: new CloudFrontClient({ region: "us-east-1" }),
    acm: new ACMClient({ region }),
    acmUsEast1: new ACMClient({ region: "us-east-1" }),
    route53: new Route53Client({ region: "us-east-1" }),
  };
}
