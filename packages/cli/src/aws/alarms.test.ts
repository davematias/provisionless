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
  TagResourceCommand,
} from "@aws-sdk/client-sns";
import { expect, it } from "vitest";

import type { AwsClients } from "./clients.ts";
import {
  ALARM_PERIOD_SECONDS,
  LOG_INGESTION_DAILY_BYTES,
  REVALIDATION_QUEUE_AGE_SECONDS,
  alarmTopicArn,
  buildAlarmDefinitions,
  buildDashboardBody,
  dashboardUrl,
  deleteObservability,
  ensureAlarms,
  ensureDashboard,
  ensureNotificationTopic,
  type ObservabilityTargets,
} from "./alarms.ts";
import { deploymentTagList } from "./tags.ts";
import type { DeployContext } from "../deploy/context.ts";

const noop = (): void => undefined;

const TARGETS: ObservabilityTargets = {
  apiId: "api123",
  functions: [
    { label: "api", name: "demo-api" },
    { label: "admin-server", name: "demo-admin-server" },
    { label: "admin-image", name: "demo-admin-image" },
    { label: "admin-revalidation", name: "demo-admin-revalidation" },
  ],
  queueName: "demo-admin-revalidation.fifo",
  deadLetterQueueName: "demo-admin-revalidation-dlq.fifo",
  tableNames: [
    "demo-users",
    "demo-reset-tokens",
    "demo-content-types",
    "demo-content-entries",
    "demo-admin-tag-cache",
  ],
};

function createContext(
  send: (command: unknown) => Promise<unknown>,
  dryRun = false,
): DeployContext {
  return {
    region: "eu-west-1",
    accountId: "111122223333",
    dryRun,
    repoRoot: ".",
    appPrefix: "demo",
    mediaBucket: "demo-media",
    log: noop,
    clients: {
      cloudwatch: { send },
      sns: { send },
    } as unknown as AwsClients,
  };
}

function capture(send: (command: unknown) => Promise<unknown>): {
  commands: unknown[];
  send: (command: unknown) => Promise<unknown>;
} {
  const commands: unknown[] = [];
  return {
    commands,
    send: async (command) => {
      commands.push(command);
      return send(command);
    },
  };
}

it("builds prefix-scoped alarms for the API, Lambdas, queue, and log ingestion", () => {
  const definitions = buildAlarmDefinitions(
    createContext(async () => ({})),
    TARGETS,
  );

  expect(definitions.map((definition) => definition.name)).toEqual([
    "demo-api-5xx",
    "demo-lambda-errors-api",
    "demo-lambda-throttles-api",
    "demo-lambda-errors-admin-server",
    "demo-lambda-throttles-admin-server",
    "demo-lambda-errors-admin-image",
    "demo-lambda-throttles-admin-image",
    "demo-lambda-errors-admin-revalidation",
    "demo-lambda-throttles-admin-revalidation",
    "demo-revalidation-queue-age",
    "demo-revalidation-dlq-depth",
    "demo-log-ingestion",
  ]);

  const api = definitions[0];
  expect(api?.namespace).toBe("AWS/ApiGateway");
  expect(api?.metricName).toBe("5XXError");
  expect(api?.dimensions).toEqual([{ Name: "ApiId", Value: "api123" }]);
  expect(api?.period).toBe(ALARM_PERIOD_SECONDS);
  expect(api?.threshold).toBe(1);

  const queue = definitions.find((definition) => definition.name.endsWith("queue-age"));
  expect(queue?.dimensions).toEqual([{ Name: "QueueName", Value: TARGETS.queueName }]);
  expect(queue?.threshold).toBe(REVALIDATION_QUEUE_AGE_SECONDS);

  const deadLetter = definitions.find((definition) => definition.name.endsWith("dlq-depth"));
  expect(deadLetter?.metricName).toBe("ApproximateNumberOfMessagesVisible");
  expect(deadLetter?.dimensions).toEqual([
    { Name: "QueueName", Value: TARGETS.deadLetterQueueName },
  ]);
  expect(deadLetter?.threshold).toBe(1);

  const logs = definitions.find((definition) => definition.name.endsWith("log-ingestion"));
  expect(logs?.threshold).toBe(LOG_INGESTION_DAILY_BYTES);
  expect(logs?.metrics).toHaveLength(5);
  expect(logs?.metrics?.at(-1)?.Expression).toBe("logs1+logs2+logs3+logs4");
  expect(logs?.metrics?.filter((metric) => metric.ReturnData !== false)).toHaveLength(1);
});

it("creates and tags the alarm topic and subscribes the email", async () => {
  const { commands, send } = capture(async (command) => {
    if (command instanceof CreateTopicCommand) {
      return { TopicArn: "arn:aws:sns:eu-west-1:111122223333:demo-alarms" };
    }
    return {};
  });
  const ctx = createContext(send);

  const arn = await ensureNotificationTopic(ctx, "ops@example.com");

  expect(arn).toBe("arn:aws:sns:eu-west-1:111122223333:demo-alarms");
  const create = commands.find((command) => command instanceof CreateTopicCommand);
  expect((create as CreateTopicCommand).input).toEqual({
    Name: "demo-alarms",
    Tags: deploymentTagList("demo"),
  });
  const tag = commands.find((command) => command instanceof TagResourceCommand);
  expect((tag as TagResourceCommand).input).toEqual({
    ResourceArn: "arn:aws:sns:eu-west-1:111122223333:demo-alarms",
    Tags: deploymentTagList("demo"),
  });
  const subscribe = commands.find((command) => command instanceof SubscribeCommand);
  expect((subscribe as SubscribeCommand).input).toEqual({
    TopicArn: "arn:aws:sns:eu-west-1:111122223333:demo-alarms",
    Protocol: "email",
    Endpoint: "ops@example.com",
  });
});

it("reuses an existing email subscription without subscribing again", async () => {
  const { commands, send } = capture(async (command) => {
    if (command instanceof CreateTopicCommand) {
      return { TopicArn: "arn:aws:sns:eu-west-1:111122223333:demo-alarms" };
    }
    if (command instanceof ListSubscriptionsByTopicCommand) {
      return { Subscriptions: [{ Protocol: "email", Endpoint: "OPS@example.com" }] };
    }
    return {};
  });

  await ensureNotificationTopic(createContext(send), "ops@example.com");

  expect(commands.some((command) => command instanceof SubscribeCommand)).toBe(false);
  expect(
    commands.filter((command) => command instanceof ListSubscriptionsByTopicCommand),
  ).toHaveLength(1);
});

it("reuses the topic and subscription on redeploy", async () => {
  let subscribed = false;
  const { commands, send } = capture(async (command) => {
    if (command instanceof CreateTopicCommand) {
      return { TopicArn: "arn:aws:sns:eu-west-1:111122223333:demo-alarms" };
    }
    if (command instanceof ListSubscriptionsByTopicCommand) {
      return subscribed
        ? { Subscriptions: [{ Protocol: "email", Endpoint: "ops@example.com" }] }
        : { Subscriptions: [] };
    }
    if (command instanceof SubscribeCommand) {
      subscribed = true;
    }
    return {};
  });
  const ctx = createContext(send);

  await ensureNotificationTopic(ctx, "ops@example.com");
  await ensureNotificationTopic(ctx, "ops@example.com");

  expect(commands.filter((command) => command instanceof SubscribeCommand)).toHaveLength(1);
  expect(
    commands
      .filter((command): command is CreateTopicCommand => command instanceof CreateTopicCommand)
      .map((command) => command.input.Name),
  ).toEqual(["demo-alarms", "demo-alarms"]);
});

it("does not touch AWS when creating the topic during a dry run", async () => {
  const commands: unknown[] = [];
  const ctx = createContext(async (command) => {
    commands.push(command);
    return {};
  }, true);

  const arn = await ensureNotificationTopic(ctx, "ops@example.com");

  expect(arn).toBe(alarmTopicArn(ctx));
  expect(commands).toEqual([]);
});

it("puts every alarm with the topic action and deployment tags", async () => {
  const { commands, send } = capture(async () => ({}));
  const ctx = createContext(send);
  const topicArn = alarmTopicArn(ctx);

  await ensureAlarms(ctx, topicArn, TARGETS);

  const alarms = commands.filter(
    (command): command is PutMetricAlarmCommand => command instanceof PutMetricAlarmCommand,
  );
  expect(alarms).toHaveLength(12);
  for (const alarm of alarms) {
    expect(alarm.input.AlarmActions).toEqual([topicArn]);
    expect(alarm.input.Tags).toEqual(deploymentTagList("demo"));
    expect(alarm.input.EvaluationPeriods).toBe(1);
    expect(alarm.input.TreatMissingData).toBe("notBreaching");
  }
  const api = alarms.find((alarm) => alarm.input.AlarmName === "demo-api-5xx");
  expect(api?.input.MetricName).toBe("5XXError");
  expect(api?.input.Namespace).toBe("AWS/ApiGateway");
  const logs = alarms.find((alarm) => alarm.input.AlarmName === "demo-log-ingestion");
  expect(logs?.input.Metrics).toHaveLength(5);
  expect(logs?.input.MetricName).toBeUndefined();
});

it("upserts the same alarm names on redeploy instead of creating duplicates", async () => {
  const { commands, send } = capture(async () => ({}));
  const ctx = createContext(send);

  await ensureAlarms(ctx, alarmTopicArn(ctx), TARGETS);
  await ensureAlarms(ctx, alarmTopicArn(ctx), TARGETS);

  const names = commands
    .filter((command): command is PutMetricAlarmCommand => command instanceof PutMetricAlarmCommand)
    .map((command) => command.input.AlarmName);
  expect(names).toHaveLength(24);
  expect(new Set(names).size).toBe(12);
});

it("does not touch AWS when creating alarms during a dry run", async () => {
  const commands: unknown[] = [];
  const ctx = createContext(async (command) => {
    commands.push(command);
    return {};
  }, true);

  await ensureAlarms(ctx, alarmTopicArn(ctx), TARGETS);

  expect(commands).toEqual([]);
});

it("builds a dashboard with API, Lambda, queue, and DynamoDB metrics", () => {
  const ctx = createContext(async () => ({}));
  const body = buildDashboardBody(ctx, TARGETS);
  const titles = body.widgets.map((widget) => widget.properties.title);

  expect(titles).toEqual([
    "API requests and errors",
    "API latency",
    "Lambda invocations and errors",
    "Lambda duration",
    "Lambda throttles",
    "Revalidation queue",
    "DynamoDB throttles",
  ]);
  const api = body.widgets[0];
  expect(api?.properties.metrics).toHaveLength(3);
  expect(api?.properties.metrics[0]).toEqual([
    "AWS/ApiGateway",
    "Count",
    "ApiId",
    "api123",
    { stat: "Sum", label: "Requests" },
  ]);
  const lambdaErrors = body.widgets[2];
  expect(lambdaErrors?.properties.metrics).toHaveLength(8);
  const queue = body.widgets[5];
  expect(queue?.properties.metrics).toHaveLength(2);
  expect(queue?.properties.metrics[1]).toEqual([
    "AWS/SQS",
    "ApproximateNumberOfMessagesVisible",
    "QueueName",
    TARGETS.deadLetterQueueName,
    { stat: "Maximum", label: "Dead-letter depth" },
  ]);
  const dynamo = body.widgets[6];
  expect(dynamo?.properties.metrics).toHaveLength(5);
  for (const widget of body.widgets) {
    expect(widget.properties.region).toBe("eu-west-1");
    expect(widget.properties.period).toBe(ALARM_PERIOD_SECONDS);
  }
});

it("creates or replaces the dashboard with deployment tags", async () => {
  const { commands, send } = capture(async () => ({}));
  const logs: string[] = [];
  const ctx = createContext(send);
  ctx.log = (message: string) => logs.push(message);

  await ensureDashboard(ctx, TARGETS);

  const put = commands.find(
    (command): command is PutDashboardCommand => command instanceof PutDashboardCommand,
  );
  expect(put?.input.DashboardName).toBe("demo-dashboard");
  expect(JSON.parse(put?.input.DashboardBody ?? "{}")).toEqual(buildDashboardBody(ctx, TARGETS));
  expect(put?.input.Tags).toEqual(deploymentTagList("demo"));
  expect(logs).toContain(`dashboard: ${dashboardUrl(ctx)}`);
});

it("replaces the dashboard on redeploy without creating duplicates", async () => {
  const { commands, send } = capture(async () => ({}));
  const ctx = createContext(send);

  await ensureDashboard(ctx, TARGETS);
  await ensureDashboard(ctx, TARGETS);

  const names = commands
    .filter((command): command is PutDashboardCommand => command instanceof PutDashboardCommand)
    .map((command) => command.input.DashboardName);
  expect(names).toEqual(["demo-dashboard", "demo-dashboard"]);
});

it("surfaces dashboard validation messages", async () => {
  const ctx = createContext(async (command) => {
    if (command instanceof PutDashboardCommand) {
      return { DashboardValidationMessages: [{ Message: "bad widget" }] };
    }
    return {};
  });

  await expect(ensureDashboard(ctx, TARGETS)).rejects.toThrow(
    "CloudWatch rejected dashboard demo-dashboard: bad widget",
  );
});

it("does not touch AWS when creating the dashboard during a dry run", async () => {
  const commands: unknown[] = [];
  const ctx = createContext(async (command) => {
    commands.push(command);
    return {};
  }, true);

  await ensureDashboard(ctx, TARGETS);

  expect(commands).toEqual([]);
});

it("deletes only the deployment alarms and its topic", async () => {
  const { commands, send } = capture(async (command) => {
    if (command instanceof DescribeAlarmsCommand) {
      return {
        MetricAlarms: [{ AlarmName: "demo-api-5xx" }, { AlarmName: "other-api-5xx" }],
      };
    }
    return {};
  });
  const ctx = createContext(send);

  await deleteObservability(ctx);

  const deleted = commands.find((command) => command instanceof DeleteAlarmsCommand) as
    | DeleteAlarmsCommand
    | undefined;
  expect(deleted?.input.AlarmNames).toEqual(["demo-api-5xx"]);
  const topicDelete = commands.find((command) => command instanceof DeleteTopicCommand) as
    | DeleteTopicCommand
    | undefined;
  expect(topicDelete?.input.TopicArn).toBe(alarmTopicArn(ctx));
  const dashboardDelete = commands.find((command) => command instanceof DeleteDashboardsCommand) as
    | DeleteDashboardsCommand
    | undefined;
  expect(dashboardDelete?.input.DashboardNames).toEqual(["demo-dashboard"]);
});

it("paginates alarm cleanup", async () => {
  const { commands, send } = capture(async (command) => {
    if (command instanceof DescribeAlarmsCommand) {
      return command.input.NextToken
        ? { MetricAlarms: [{ AlarmName: "demo-log-ingestion" }] }
        : { MetricAlarms: [{ AlarmName: "demo-api-5xx" }], NextToken: "page-2" };
    }
    return {};
  });

  await deleteObservability(createContext(send));

  const deleted = commands.find((command) => command instanceof DeleteAlarmsCommand) as
    | DeleteAlarmsCommand
    | undefined;
  expect(deleted?.input.AlarmNames).toEqual(["demo-api-5xx", "demo-log-ingestion"]);
});

it("tolerates a missing topic during cleanup", async () => {
  const logs: string[] = [];
  const ctx = createContext(async (command) => {
    if (command instanceof DescribeAlarmsCommand) {
      return { MetricAlarms: [] };
    }
    if (command instanceof DeleteTopicCommand) {
      const error = new Error("missing");
      error.name = "NotFoundException";
      throw error;
    }
    return {};
  });
  ctx.log = (message: string) => logs.push(message);

  await deleteObservability(ctx);

  expect(logs).toContain("no SNS topic demo-alarms");
  expect(logs).toContain("no CloudWatch alarms for demo");
});

it("does not touch AWS when deleting observability during a dry run", async () => {
  const commands: unknown[] = [];
  const ctx = createContext(async (command) => {
    commands.push(command);
    return {};
  }, true);

  await deleteObservability(ctx);

  expect(commands).toEqual([]);
});
