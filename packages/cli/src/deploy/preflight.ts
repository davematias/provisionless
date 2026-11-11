import { GetRoleCommand, SimulatePrincipalPolicyCommand } from "@aws-sdk/client-iam";
import { GetCallerIdentityCommand } from "@aws-sdk/client-sts";

import { lambdaLogGroupName } from "../aws/logs.ts";
import { adminNames, apiNames } from "../aws/names.ts";
import { isAwsError } from "../util/aws.ts";
import type { DeployContext } from "./context.ts";

export interface PermissionGroup {
  /** IAM service prefix used when grouping the report. */
  service: string;
  actions: string[];
  resources: string[];
}

export interface PreflightResult {
  principalArn: string;
  actionCount: number;
}

interface Denial {
  service: string;
  action: string;
  resource: string;
}

const SERVICE_NAMES: Record<string, string> = {
  acm: "ACM",
  apigateway: "API Gateway",
  cloudfront: "CloudFront",
  cloudwatch: "CloudWatch",
  dynamodb: "DynamoDB",
  iam: "IAM",
  lambda: "Lambda",
  logs: "CloudWatch Logs",
  route53: "Route 53",
  s3: "S3",
  ses: "SES",
  sns: "SNS",
  sqs: "SQS",
  sts: "STS",
};

function arn(ctx: DeployContext, service: string, resource: string, region = ctx.region): string {
  return `arn:aws:${service}:${region}:${ctx.accountId}:${resource}`;
}

function hostedZoneArn(ctx: DeployContext): string {
  const zone = ctx.hostedZone;
  const id = zone && /^Z[0-9A-Z]+$/.test(zone) ? zone : "*";
  return `arn:aws:route53:::hostedzone/${id}`;
}

/** The IAM actions and resources the deploy path can use. */
export function requiredPermissionGroups(ctx: DeployContext): PermissionGroup[] {
  const api = apiNames(ctx.appPrefix);
  const admin = adminNames(ctx.appPrefix, ctx.accountId);
  const groups: PermissionGroup[] = [];

  groups.push({
    service: "sts",
    actions: ["sts:GetCallerIdentity"],
    resources: ["*"],
  });

  groups.push({
    service: "iam",
    actions: [
      "iam:GetRole",
      "iam:CreateRole",
      "iam:AttachRolePolicy",
      "iam:PutRolePolicy",
      "iam:TagRole",
      "iam:PassRole",
    ],
    resources: [arn(ctx, "iam", `role/${api.role}`), arn(ctx, "iam", `role/${admin.role}`)],
  });

  const functions = [
    api.function,
    admin.serverFunction,
    admin.imageFunction,
    admin.revalidationFunction,
  ];
  groups.push({
    service: "lambda",
    actions: [
      "lambda:GetFunction",
      "lambda:CreateFunction",
      "lambda:UpdateFunctionConfiguration",
      "lambda:UpdateFunctionCode",
      "lambda:AddPermission",
      "lambda:TagResource",
      "lambda:GetFunctionUrlConfig",
      "lambda:CreateFunctionUrlConfig",
      "lambda:CreateEventSourceMapping",
    ],
    resources: functions.map((name) => arn(ctx, "lambda", `function:${name}`)),
  });

  groups.push({
    service: "apigateway",
    actions: ["apigateway:GET", "apigateway:POST", "apigateway:PATCH", "apigateway:TagResource"],
    resources: [
      `arn:aws:apigateway:${ctx.region}::/apis/*`,
      `arn:aws:apigateway:${ctx.region}::/apis/*/stages/*`,
    ],
  });
  if (ctx.adminDomain || ctx.apiDomain) {
    groups.push({
      service: "apigateway",
      actions: ["apigateway:GET", "apigateway:POST", "apigateway:PATCH", "apigateway:TagResource"],
      resources: [`arn:aws:apigateway:${ctx.region}::/domainnames/*`],
    });
  }

  const buckets = [ctx.mediaBucket, admin.assetsBucket];
  const bucketArns = buckets.map((bucket) => `arn:aws:s3:::${bucket}`);
  const assetsBucketArn = `arn:aws:s3:::${admin.assetsBucket}`;
  groups.push({
    service: "s3",
    actions: ["s3:ListBucket", "s3:CreateBucket", "s3:GetBucketLocation", "s3:PutBucketTagging"],
    resources: bucketArns,
  });
  groups.push({
    service: "s3",
    actions: ["s3:PutBucketPolicy"],
    resources: [assetsBucketArn],
  });
  groups.push({
    service: "s3",
    actions: ["s3:PutObject"],
    resources: [`${assetsBucketArn}/*`],
  });

  const tables = [
    api.usersTable,
    api.resetTokensTable,
    api.contentTypesTable,
    api.contentEntriesTable,
    admin.tagCacheTable,
  ];
  groups.push({
    service: "dynamodb",
    actions: ["dynamodb:DescribeTable", "dynamodb:CreateTable", "dynamodb:TagResource"],
    resources: tables.map((name) => arn(ctx, "dynamodb", `table/${name}`)),
  });
  groups.push({
    service: "dynamodb",
    actions: ["dynamodb:UpdateTimeToLive"],
    resources: [arn(ctx, "dynamodb", `table/${api.resetTokensTable}`)],
  });
  groups.push({
    service: "dynamodb",
    actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"],
    resources: [arn(ctx, "dynamodb", `table/${api.usersTable}`)],
  });

  const queues = [admin.revalidationQueue, admin.revalidationDlq];
  groups.push({
    service: "sqs",
    actions: ["sqs:GetQueueUrl", "sqs:GetQueueAttributes", "sqs:CreateQueue", "sqs:TagQueue"],
    resources: queues.map((name) => arn(ctx, "sqs", name)),
  });
  groups.push({
    service: "sqs",
    actions: ["sqs:SetQueueAttributes"],
    resources: [arn(ctx, "sqs", admin.revalidationQueue)],
  });

  groups.push({
    service: "sns",
    actions: [
      "sns:CreateTopic",
      "sns:TagResource",
      "sns:ListSubscriptionsByTopic",
      "sns:Subscribe",
    ],
    resources: [arn(ctx, "sns", `${ctx.appPrefix}-alarms`)],
  });

  if (ctx.emailFrom) {
    groups.push({
      service: "ses",
      actions: ["ses:GetEmailIdentity", "ses:CreateEmailIdentity", "ses:TagResource"],
      resources: [arn(ctx, "ses", `identity/${ctx.emailFrom}`)],
    });
  }

  groups.push({
    service: "cloudfront",
    actions: ["cloudfront:ListDistributions", "cloudfront:ListOriginAccessControls"],
    resources: ["*"],
  });
  groups.push({
    service: "cloudfront",
    actions: [
      "cloudfront:GetDistribution",
      "cloudfront:CreateDistribution",
      "cloudfront:UpdateDistribution",
      "cloudfront:TagResource",
    ],
    resources: [`arn:aws:cloudfront::${ctx.accountId}:distribution/*`],
  });
  groups.push({
    service: "cloudfront",
    actions: ["cloudfront:CreateOriginAccessControl"],
    resources: [`arn:aws:cloudfront::${ctx.accountId}:origin-access-control/*`],
  });
  groups.push({
    service: "cloudfront",
    actions: [
      "cloudfront:DescribeFunction",
      "cloudfront:GetFunction",
      "cloudfront:CreateFunction",
      "cloudfront:UpdateFunction",
      "cloudfront:PublishFunction",
      "cloudfront:TagResource",
    ],
    resources: [`arn:aws:cloudfront::${ctx.accountId}:function/*`],
  });

  const logGroups = [...functions.map(lambdaLogGroupName), api.accessLogGroup];
  groups.push({
    service: "logs",
    actions: [
      "logs:CreateLogGroup",
      "logs:PutRetentionPolicy",
      "logs:TagResource",
      "logs:DescribeResourcePolicies",
      "logs:PutResourcePolicy",
    ],
    resources: logGroups.map((name) => arn(ctx, "logs", `log-group:${name}`)),
  });

  groups.push({
    service: "cloudwatch",
    actions: ["cloudwatch:PutMetricAlarm", "cloudwatch:TagResource"],
    resources: [arn(ctx, "cloudwatch", "alarm:*")],
  });
  groups.push({
    service: "cloudwatch",
    actions: ["cloudwatch:PutDashboard", "cloudwatch:TagResource"],
    resources: [arn(ctx, "cloudwatch", "dashboard/*")],
  });

  if (ctx.adminDomain || ctx.apiDomain) {
    groups.push({
      service: "acm",
      actions: ["acm:ListCertificates"],
      resources: ["*"],
    });
  }
  if (ctx.adminDomain) {
    groups.push({
      service: "acm",
      actions: ["acm:DescribeCertificate", "acm:RequestCertificate", "acm:AddTagsToCertificate"],
      resources: [`arn:aws:acm:us-east-1:${ctx.accountId}:certificate/*`],
    });
  }
  if (ctx.apiDomain) {
    groups.push({
      service: "acm",
      actions: ["acm:DescribeCertificate", "acm:RequestCertificate", "acm:AddTagsToCertificate"],
      resources: [arn(ctx, "acm", "certificate/*")],
    });
  }

  if (ctx.hostedZone) {
    groups.push({
      service: "route53",
      actions: ["route53:ListHostedZonesByName"],
      resources: ["*"],
    });
    groups.push({
      service: "route53",
      actions: ["route53:ChangeResourceRecordSets"],
      resources: [hostedZoneArn(ctx)],
    });
  }

  return groups;
}

/**
 * Resolves the IAM user or role behind the caller. STS returns assumed-role session ARNs, which the
 * policy simulator does not accept, so role sessions are mapped back to their IAM role ARN.
 */
export async function resolvePrincipalArn(
  ctx: DeployContext,
  identityArn: string,
): Promise<string> {
  if (
    /^arn:aws:iam::\d+:user\//.test(identityArn) ||
    /^arn:aws:iam::\d+:role\//.test(identityArn)
  ) {
    return identityArn;
  }

  const assumed = /^arn:aws:sts::\d+:assumed-role\/([^/]+)\//.exec(identityArn);
  if (assumed?.[1]) {
    try {
      const role = await ctx.clients.iam.send(new GetRoleCommand({ RoleName: assumed[1] }));
      if (role.Role?.Arn) {
        return role.Role.Arn;
      }
      throw new Error(`IAM did not return an ARN for role ${assumed[1]}`);
    } catch (error) {
      if (isAwsError(error, "NoSuchEntity") || isAwsError(error, "NoSuchEntityException")) {
        throw new Error(
          `Preflight could not find the IAM role behind ${identityArn}. Run deploy with an IAM user or role that still exists.`,
          { cause: error },
        );
      }
      if (isAwsError(error, "AccessDenied") || isAwsError(error, "AccessDeniedException")) {
        throw new Error(
          `Preflight needs iam:GetRole to resolve the role behind ${identityArn}. Grant that permission or run deploy with an IAM user.`,
          { cause: error },
        );
      }
      throw error;
    }
  }

  if (identityArn.endsWith(":root")) {
    throw new Error(
      "Preflight cannot simulate the AWS account root user. Run Provisionless under a dedicated IAM user or role, then retry.",
    );
  }
  if (identityArn.includes(":federated-user/")) {
    throw new Error(
      "Preflight cannot simulate federated users or their sessions. Run Provisionless under an IAM user or an assumed role.",
    );
  }

  throw new Error(
    `Preflight cannot simulate the caller identity ${identityArn}. Run Provisionless under an IAM user or an assumed role.`,
  );
}

function simulationError(error: unknown): Error {
  if (isAwsError(error, "AccessDenied") || isAwsError(error, "AccessDeniedException")) {
    return new Error(
      "Preflight needs iam:SimulatePrincipalPolicy to check permissions, but AWS denied that action. Grant it to the caller, or run the check with a principal that has it.",
      { cause: error },
    );
  }
  if (isAwsError(error, "NoSuchEntity") || isAwsError(error, "NoSuchEntityException")) {
    return new Error(
      "Preflight could not find the IAM principal to simulate. Check that the caller identity still exists.",
      { cause: error },
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

function formatDenials(denials: Denial[], principalArn: string): string {
  const grouped = new Map<string, Denial[]>();
  for (const denial of denials) {
    const list = grouped.get(denial.service) ?? [];
    list.push(denial);
    grouped.set(denial.service, list);
  }

  const sections = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([service, entries]) => {
      const lines = entries.map((entry) => `  - ${entry.action} on ${entry.resource}`);
      return `${SERVICE_NAMES[service] ?? service}:\n${lines.join("\n")}`;
    });

  return [
    `Preflight failed: ${denials.length} required permission(s) are denied for ${principalArn}.`,
    ...sections,
    "",
    "The check is advisory: it simulates identity policies and SCPs, but does not verify resource policies, service quotas, region opt-in, SES sandbox status, or permissions for resource IDs that do not exist yet.",
    "Grant the missing actions, or run Provisionless under a dedicated IAM user or role with only the permissions it needs.",
    "The preflight itself needs iam:SimulatePrincipalPolicy, and iam:GetRole when the caller is an assumed role.",
  ].join("\n");
}

/**
 * Checks the caller's IAM permissions with the policy simulator. It never provisions or mutates a
 * resource; it only calls STS, IAM GetRole when needed, and IAM SimulatePrincipalPolicy.
 */
export async function runPreflight(ctx: DeployContext): Promise<PreflightResult> {
  const identity = await ctx.clients.sts.send(new GetCallerIdentityCommand({}));
  if (!identity.Arn) {
    throw new Error("Preflight could not determine the caller identity from STS.");
  }
  const principalArn = await resolvePrincipalArn(ctx, identity.Arn);
  const groups = requiredPermissionGroups(ctx);
  const actions = new Set(groups.flatMap((group) => group.actions));
  const denials: Denial[] = [];
  const missingContext = new Set<string>();

  ctx.log(
    `preflight: checking ${actions.size} required actions for ${principalArn} in ${ctx.region}`,
  );

  for (const group of groups) {
    if (group.actions.length === 0 || group.resources.length === 0) {
      continue;
    }

    let marker: string | undefined;
    do {
      let response;
      try {
        response = await ctx.clients.iam.send(
          new SimulatePrincipalPolicyCommand({
            PolicySourceArn: principalArn,
            ActionNames: group.actions,
            ResourceArns: group.resources,
            MaxItems: 1000,
            Marker: marker,
          }),
        );
      } catch (error) {
        throw simulationError(error);
      }

      for (const result of response.EvaluationResults ?? []) {
        for (const key of result.MissingContextValues ?? []) {
          missingContext.add(key);
        }
        if (result.EvalDecision !== "allowed") {
          const action = result.EvalActionName ?? "unknown";
          denials.push({
            service: action.split(":")[0] ?? group.service,
            action,
            resource: result.EvalResourceName ?? "*",
          });
        }
      }
      marker = response.IsTruncated ? response.Marker : undefined;
    } while (marker);
  }

  if (missingContext.size > 0) {
    ctx.log(
      `preflight warning: the simulation could not evaluate these condition keys: ${[...missingContext].join(", ")}`,
    );
  }

  if (denials.length > 0) {
    throw new Error(formatDenials(denials, principalArn));
  }

  ctx.log(`preflight passed: ${actions.size} required actions are allowed for ${principalArn}`);
  ctx.log(
    "preflight note: advisory check only; resource policies, quotas, region opt-in, SES sandbox, and not-yet-created resource IDs are not covered. Use a dedicated IAM user or role for Provisionless.",
  );
  return { principalArn, actionCount: actions.size };
}
