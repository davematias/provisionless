import { expect, it } from "vitest";

import { describeAwsError } from "./aws.ts";

it("explains missing credentials", () => {
  const error = new Error("Could not load credentials from any providers");
  error.name = "CredentialsProviderError";

  expect(describeAwsError(error, "list deployments").message).toContain(
    "No AWS credentials found while trying to list deployments",
  );
});

it("explains expired credentials, including a wrapped cause", () => {
  const cause = new Error("expired");
  cause.name = "ExpiredTokenException";
  const error = new Error("failed", { cause });

  expect(describeAwsError(error, "list deployments").message).toContain(
    "AWS credentials have expired",
  );
});

it("explains access denied with the required read permissions", () => {
  const error = new Error("denied");
  error.name = "AccessDeniedException";

  const message = describeAwsError(error, "list deployments").message;
  expect(message).toContain("AWS denied permission");
  expect(message).toContain("tag:GetResources");
  expect(message).toContain("account:ListRegions");
});

it("returns unrelated errors unchanged", () => {
  const error = new Error("boom");
  expect(describeAwsError(error, "list deployments")).toBe(error);
});
