import type { ComparisonOperator, MetricDataQuery, Statistic } from "@aws-sdk/client-cloudwatch";
import {
  DeleteAlarmsCommand,
  DeleteDashboardsCommand,
  DescribeAlarmsCommand,
  PutDashboardCommand,
  PutMetricAlarmCommand,
} from "@aws-sdk/client-cloudwatch";
import {
  CreateTopicCommand,
  DeleteTopicCommand,
  ListSubscriptionsByTopicCommand,
  SubscribeCommand,
  TagResourceCommand as SnsTagResourceCommand,
} from "@aws-sdk/client-sns";

import type { DeployContext } from "../deploy/context.ts";
import { isAwsError } from "../util/aws.ts";
import { lambdaLogGroupName } from "./logs.ts";
import { observabilityNames } from "./names.ts";
import { deploymentTagList } from "./tags.ts";

/** Seconds the oldest revalidation message may wait before the queue alarm fires. */
export const REVALIDATION_QUEUE_AGE_SECONDS = 300;

/** Daily bytes ingested across the deployment log groups before the cost alarm fires. */
export const LOG_INGESTION_DAILY_BYTES = 1024 * 1024 * 1024;

/** Period shared by the request, error, throttle, and queue alarms. */
export const ALARM_PERIOD_SECONDS = 300;

const TREAT_MISSING_DATA = "notBreaching";

export interface AlarmFunction {
  /** Short, stable label used in the alarm name. */
  label: string;
  /** Lambda function name. */
  name: string;
}

export interface ObservabilityTargets {
  /** API Gateway HTTP API ID; omitted only when the API was not created. */
  apiId?: string;
  functions: AlarmFunction[];
  /** Revalidation queue name (including the .fifo suffix). */
  queueName: string;
  /** Revalidation dead-letter queue name (including the .fifo suffix). */
  deadLetterQueueName?: string;
  /** DynamoDB table names that should appear on the dashboard. */
  tableNames: string[];
}

export interface AlarmDefinition {
  name: string;
  description: string;
  metricName?: string;
  namespace?: string;
  statistic?: Statistic;
  dimensions?: Array<{ Name: string; Value: string }>;
  period?: number;
  metrics?: MetricDataQuery[];
  threshold: number;
  comparisonOperator: ComparisonOperator;
}

/** ARN of the deployment alarm topic. */
export function alarmTopicArn(ctx: DeployContext): string {
  const { topic } = observabilityNames(ctx.appPrefix);
  return `arn:aws:sns:${ctx.region}:${ctx.accountId}:${topic}`;
}

/** Builds every alarm the deployment needs, with names scoped to the app prefix. */
export function buildAlarmDefinitions(
  ctx: DeployContext,
  targets: ObservabilityTargets,
): AlarmDefinition[] {
  const prefix = ctx.appPrefix;
  const definitions: AlarmDefinition[] = [];

  if (targets.apiId) {
    definitions.push({
      name: `${prefix}-api-5xx`,
      description: "API Gateway returned one or more 5XX responses in the last 5 minutes.",
      namespace: "AWS/ApiGateway",
      metricName: "5XXError",
      statistic: "Sum",
      dimensions: [{ Name: "ApiId", Value: targets.apiId }],
      period: ALARM_PERIOD_SECONDS,
      threshold: 1,
      comparisonOperator: "GreaterThanOrEqualToThreshold",
    });
  }

  for (const fn of targets.functions) {
    definitions.push({
      name: `${prefix}-lambda-errors-${fn.label}`,
      description: `Lambda ${fn.name} reported one or more errors in the last 5 minutes.`,
      namespace: "AWS/Lambda",
      metricName: "Errors",
      statistic: "Sum",
      dimensions: [{ Name: "FunctionName", Value: fn.name }],
      period: ALARM_PERIOD_SECONDS,
      threshold: 1,
      comparisonOperator: "GreaterThanOrEqualToThreshold",
    });
    definitions.push({
      name: `${prefix}-lambda-throttles-${fn.label}`,
      description: `Lambda ${fn.name} was throttled one or more times in the last 5 minutes.`,
      namespace: "AWS/Lambda",
      metricName: "Throttles",
      statistic: "Sum",
      dimensions: [{ Name: "FunctionName", Value: fn.name }],
      period: ALARM_PERIOD_SECONDS,
      threshold: 1,
      comparisonOperator: "GreaterThanOrEqualToThreshold",
    });
  }

  definitions.push({
    name: `${prefix}-revalidation-queue-age`,
    description: `The oldest revalidation message is at least ${REVALIDATION_QUEUE_AGE_SECONDS} seconds old.`,
    namespace: "AWS/SQS",
    metricName: "ApproximateAgeOfOldestMessage",
    statistic: "Maximum",
    dimensions: [{ Name: "QueueName", Value: targets.queueName }],
    period: ALARM_PERIOD_SECONDS,
    threshold: REVALIDATION_QUEUE_AGE_SECONDS,
    comparisonOperator: "GreaterThanOrEqualToThreshold",
  });

  if (targets.deadLetterQueueName) {
    definitions.push({
      name: `${prefix}-revalidation-dlq-depth`,
      description: "The revalidation dead-letter queue holds one or more messages.",
      namespace: "AWS/SQS",
      metricName: "ApproximateNumberOfMessagesVisible",
      statistic: "Maximum",
      dimensions: [{ Name: "QueueName", Value: targets.deadLetterQueueName }],
      period: ALARM_PERIOD_SECONDS,
      threshold: 1,
      comparisonOperator: "GreaterThanOrEqualToThreshold",
    });
  }

  const logMetrics: MetricDataQuery[] = targets.functions.map((fn, index) => ({
    Id: `logs${index + 1}`,
    MetricStat: {
      Metric: {
        Namespace: "AWS/Logs",
        MetricName: "IncomingBytes",
        Dimensions: [{ Name: "LogGroupName", Value: lambdaLogGroupName(fn.name) }],
      },
      Period: 86400,
      Stat: "Sum",
    },
    ReturnData: false,
  }));
  if (logMetrics.length > 0) {
    logMetrics.push({
      Id: "total",
      Expression: logMetrics.map((metric) => metric.Id).join("+"),
      Label: "Daily log ingestion bytes",
      ReturnData: true,
    });
    definitions.push({
      name: `${prefix}-log-ingestion`,
      description: `Deployment Lambda log groups ingested at least ${LOG_INGESTION_DAILY_BYTES} bytes in a day.`,
      metrics: logMetrics,
      threshold: LOG_INGESTION_DAILY_BYTES,
      comparisonOperator: "GreaterThanOrEqualToThreshold",
    });
  }

  return definitions;
}

async function ensureEmailSubscription(
  ctx: DeployContext,
  topicArn: string,
  email: string,
): Promise<void> {
  let nextToken: string | undefined;
  do {
    const page = await ctx.clients.sns.send(
      new ListSubscriptionsByTopicCommand({ TopicArn: topicArn, NextToken: nextToken }),
    );
    const existing = (page.Subscriptions ?? []).some(
      (subscription) =>
        subscription.Protocol?.toLowerCase() === "email" &&
        subscription.Endpoint?.toLowerCase() === email.toLowerCase(),
    );
    if (existing) {
      ctx.log(`reusing the existing alarm email subscription for ${email}`);
      return;
    }
    nextToken = page.NextToken;
  } while (nextToken);

  await ctx.clients.sns.send(
    new SubscribeCommand({ TopicArn: topicArn, Protocol: "email", Endpoint: email }),
  );
  ctx.log(`subscribed ${email} to the alarm topic; confirm the subscription in your inbox`);
}

/** Creates or reuses the SNS topic used by all deployment alarms. */
export async function ensureNotificationTopic(
  ctx: DeployContext,
  email: string | undefined,
): Promise<string> {
  const { topic } = observabilityNames(ctx.appPrefix);
  const arn = alarmTopicArn(ctx);

  if (ctx.dryRun) {
    ctx.log(
      email
        ? `would create or reuse SNS topic ${topic} and subscribe ${email}`
        : `would create or reuse SNS topic ${topic} without an email subscriber`,
    );
    return arn;
  }

  const created = await ctx.clients.sns.send(
    new CreateTopicCommand({ Name: topic, Tags: deploymentTagList(ctx.appPrefix) }),
  );
  const topicArn = created.TopicArn ?? arn;
  await ctx.clients.sns.send(
    new SnsTagResourceCommand({
      ResourceArn: topicArn,
      Tags: deploymentTagList(ctx.appPrefix),
    }),
  );

  if (email) {
    await ensureEmailSubscription(ctx, topicArn, email);
  } else {
    ctx.log(`alarm topic ${topic} has no email subscriber`);
  }
  return topicArn;
}

/** Creates or updates every deployment alarm. */
export async function ensureAlarms(
  ctx: DeployContext,
  topicArn: string,
  targets: ObservabilityTargets,
): Promise<void> {
  const definitions = buildAlarmDefinitions(ctx, targets);
  if (ctx.dryRun) {
    ctx.log(`would create or update ${definitions.length} CloudWatch alarms`);
    return;
  }

  for (const definition of definitions) {
    await ctx.clients.cloudwatch.send(
      new PutMetricAlarmCommand({
        AlarmName: definition.name,
        AlarmDescription: definition.description,
        ActionsEnabled: true,
        AlarmActions: [topicArn],
        MetricName: definition.metricName,
        Namespace: definition.namespace,
        Statistic: definition.statistic,
        Dimensions: definition.dimensions,
        Period: definition.period,
        Metrics: definition.metrics,
        EvaluationPeriods: 1,
        Threshold: definition.threshold,
        ComparisonOperator: definition.comparisonOperator,
        TreatMissingData: TREAT_MISSING_DATA,
        Tags: deploymentTagList(ctx.appPrefix),
      }),
    );
  }
  ctx.log(`configured ${definitions.length} CloudWatch alarms`);
}

export interface DashboardMetricWidget {
  type: "metric";
  x: number;
  y: number;
  width: number;
  height: number;
  properties: {
    metrics: unknown[][];
    view: "timeSeries";
    region: string;
    title: string;
    period: number;
  };
}

export interface DashboardBody {
  widgets: DashboardMetricWidget[];
}

function lambdaMetrics(
  targets: ObservabilityTargets,
  metricName: string,
  stat: string,
): unknown[][] {
  return targets.functions.map((fn) => [
    "AWS/Lambda",
    metricName,
    "FunctionName",
    fn.name,
    { stat, label: `${fn.label} ${metricName}` },
  ]);
}

/** Builds the deployment dashboard body from the metrics the stack publishes. */
export function buildDashboardBody(
  ctx: DeployContext,
  targets: ObservabilityTargets,
): DashboardBody {
  const widgets: DashboardMetricWidget[] = [];
  const region = ctx.region;
  const period = ALARM_PERIOD_SECONDS;
  let y = 0;

  if (targets.apiId) {
    widgets.push({
      type: "metric",
      x: 0,
      y,
      width: 12,
      height: 6,
      properties: {
        metrics: [
          ["AWS/ApiGateway", "Count", "ApiId", targets.apiId, { stat: "Sum", label: "Requests" }],
          ["AWS/ApiGateway", "4XXError", "ApiId", targets.apiId, { stat: "Sum", label: "4xx" }],
          ["AWS/ApiGateway", "5XXError", "ApiId", targets.apiId, { stat: "Sum", label: "5xx" }],
        ],
        view: "timeSeries",
        region,
        title: "API requests and errors",
        period,
      },
    });
    widgets.push({
      type: "metric",
      x: 12,
      y,
      width: 12,
      height: 6,
      properties: {
        metrics: [
          [
            "AWS/ApiGateway",
            "Latency",
            "ApiId",
            targets.apiId,
            { stat: "Average", label: "Latency" },
          ],
        ],
        view: "timeSeries",
        region,
        title: "API latency",
        period,
      },
    });
    y += 6;
  }

  widgets.push({
    type: "metric",
    x: 0,
    y,
    width: 12,
    height: 6,
    properties: {
      metrics: [
        ...lambdaMetrics(targets, "Invocations", "Sum"),
        ...lambdaMetrics(targets, "Errors", "Sum"),
      ],
      view: "timeSeries",
      region,
      title: "Lambda invocations and errors",
      period,
    },
  });
  widgets.push({
    type: "metric",
    x: 12,
    y,
    width: 12,
    height: 6,
    properties: {
      metrics: lambdaMetrics(targets, "Duration", "Average"),
      view: "timeSeries",
      region,
      title: "Lambda duration",
      period,
    },
  });
  y += 6;

  widgets.push({
    type: "metric",
    x: 0,
    y,
    width: 12,
    height: 6,
    properties: {
      metrics: lambdaMetrics(targets, "Throttles", "Sum"),
      view: "timeSeries",
      region,
      title: "Lambda throttles",
      period,
    },
  });

  const queueMetrics: unknown[][] = [
    [
      "AWS/SQS",
      "ApproximateAgeOfOldestMessage",
      "QueueName",
      targets.queueName,
      { stat: "Maximum", label: "Oldest message age" },
    ],
  ];
  if (targets.deadLetterQueueName) {
    queueMetrics.push([
      "AWS/SQS",
      "ApproximateNumberOfMessagesVisible",
      "QueueName",
      targets.deadLetterQueueName,
      { stat: "Maximum", label: "Dead-letter depth" },
    ]);
  }
  widgets.push({
    type: "metric",
    x: 12,
    y,
    width: 12,
    height: 6,
    properties: {
      metrics: queueMetrics,
      view: "timeSeries",
      region,
      title: "Revalidation queue",
      period,
    },
  });
  y += 6;

  widgets.push({
    type: "metric",
    x: 0,
    y,
    width: 24,
    height: 6,
    properties: {
      metrics: targets.tableNames.map((tableName) => [
        "AWS/DynamoDB",
        "ThrottledRequests",
        "TableName",
        tableName,
        { stat: "Sum", label: tableName },
      ]),
      view: "timeSeries",
      region,
      title: "DynamoDB throttles",
      period,
    },
  });

  return { widgets };
}

/** URL of the deployment dashboard in the CloudWatch console. */
export function dashboardUrl(ctx: DeployContext): string {
  const { dashboard } = observabilityNames(ctx.appPrefix);
  return `https://${ctx.region}.console.aws.amazon.com/cloudwatch/home?region=${ctx.region}#dashboards:name=${encodeURIComponent(dashboard)}`;
}

/** Creates or replaces the deployment dashboard. */
export async function ensureDashboard(
  ctx: DeployContext,
  targets: ObservabilityTargets,
): Promise<void> {
  const { dashboard } = observabilityNames(ctx.appPrefix);

  if (ctx.dryRun) {
    ctx.log(`would create or update CloudWatch dashboard ${dashboard}`);
    return;
  }

  const result = await ctx.clients.cloudwatch.send(
    new PutDashboardCommand({
      DashboardName: dashboard,
      DashboardBody: JSON.stringify(buildDashboardBody(ctx, targets)),
      Tags: deploymentTagList(ctx.appPrefix),
    }),
  );
  const messages = (result.DashboardValidationMessages ?? [])
    .map((message) => message.Message)
    .filter((message): message is string => Boolean(message));
  if (messages.length > 0) {
    throw new Error(`CloudWatch rejected dashboard ${dashboard}: ${messages.join("; ")}`);
  }

  ctx.log(`dashboard: ${dashboardUrl(ctx)}`);
}

/** Deletes the deployment dashboard, leaving other prefixes untouched. */
export async function deleteDashboard(ctx: DeployContext): Promise<void> {
  const { dashboard } = observabilityNames(ctx.appPrefix);

  if (ctx.dryRun) {
    ctx.log(`would delete CloudWatch dashboard ${dashboard}`);
    return;
  }

  try {
    await ctx.clients.cloudwatch.send(new DeleteDashboardsCommand({ DashboardNames: [dashboard] }));
    ctx.log(`deleted CloudWatch dashboard ${dashboard}`);
  } catch (error) {
    if (
      !isAwsError(error, "ResourceNotFound") &&
      !isAwsError(error, "DashboardNotFound") &&
      !isAwsError(error, "NotFoundException")
    ) {
      throw error;
    }
    ctx.log(`no CloudWatch dashboard ${dashboard}`);
  }
}

/** Creates the deployment notification topic, its alarms, and the dashboard. */
export async function ensureObservability(
  ctx: DeployContext,
  targets: ObservabilityTargets,
): Promise<void> {
  const topicArn = await ensureNotificationTopic(ctx, ctx.alarmEmail);
  await ensureAlarms(ctx, topicArn, targets);
  await ensureDashboard(ctx, targets);
}

async function listAlarmNames(ctx: DeployContext): Promise<string[]> {
  const names: string[] = [];
  let nextToken: string | undefined;
  do {
    const page = await ctx.clients.cloudwatch.send(
      new DescribeAlarmsCommand({
        AlarmNamePrefix: `${ctx.appPrefix}-`,
        NextToken: nextToken,
      }),
    );
    for (const alarm of page.MetricAlarms ?? []) {
      if (alarm.AlarmName?.startsWith(`${ctx.appPrefix}-`)) {
        names.push(alarm.AlarmName);
      }
    }
    nextToken = page.NextToken;
  } while (nextToken);
  return names;
}

/** Deletes the deployment alarms and alarm topic, leaving other deployments untouched. */
export async function deleteObservability(ctx: DeployContext): Promise<void> {
  const { topic } = observabilityNames(ctx.appPrefix);

  if (ctx.dryRun) {
    ctx.log(`would delete CloudWatch alarms and SNS topic ${topic} for ${ctx.appPrefix}`);
    await deleteDashboard(ctx);
    return;
  }

  const alarmNames = await listAlarmNames(ctx);
  if (alarmNames.length > 0) {
    await ctx.clients.cloudwatch.send(new DeleteAlarmsCommand({ AlarmNames: alarmNames }));
    ctx.log(`deleted ${alarmNames.length} CloudWatch alarms`);
  } else {
    ctx.log(`no CloudWatch alarms for ${ctx.appPrefix}`);
  }

  try {
    await ctx.clients.sns.send(new DeleteTopicCommand({ TopicArn: alarmTopicArn(ctx) }));
    ctx.log(`deleted SNS topic ${topic}`);
  } catch (error) {
    if (!isAwsError(error, "NotFound") && !isAwsError(error, "NotFoundException")) {
      throw error;
    }
    ctx.log(`no SNS topic ${topic}`);
  }

  await deleteDashboard(ctx);
}
