import { ApiGatewayV2Client } from "@aws-sdk/client-apigatewayv2";
import { CloudFrontClient } from "@aws-sdk/client-cloudfront";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { IAMClient } from "@aws-sdk/client-iam";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { STSClient } from "@aws-sdk/client-sts";

export interface AwsClients {
  sts: STSClient;
  iam: IAMClient;
  lambda: LambdaClient;
  apiGateway: ApiGatewayV2Client;
  s3: S3Client;
  sqs: SQSClient;
  dynamodb: DynamoDBClient;
  cloudfront: CloudFrontClient;
}

export function createAwsClients(region: string): AwsClients {
  return {
    sts: new STSClient({ region }),
    iam: new IAMClient({ region }),
    lambda: new LambdaClient({ region }),
    apiGateway: new ApiGatewayV2Client({ region }),
    s3: new S3Client({ region }),
    sqs: new SQSClient({ region }),
    dynamodb: new DynamoDBClient({ region }),
    cloudfront: new CloudFrontClient({ region: "us-east-1" }),
  };
}
