export function isAwsError(error: unknown, name: string): boolean {
  return typeof error === "object" && error !== null && (error as { name?: string }).name === name;
}

function errorChain(error: unknown): Array<{ name?: string; message?: string }> {
  const chain: Array<{ name?: string; message?: string }> = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    const entry = current as { name?: string; message?: string; cause?: unknown };
    chain.push(entry);
    current = entry.cause;
  }
  return chain;
}

/**
 * Converts common AWS credential and permission failures into actionable messages. Other errors are
 * returned unchanged.
 */
export function describeAwsError(error: unknown, action: string): Error {
  const chain = errorChain(error);
  const names = chain.map((entry) => entry.name ?? "");
  const messages = chain.map((entry) => entry.message ?? "").join(" ");

  if (
    names.some((name) => name === "CredentialsProviderError") ||
    /could not load credentials|credential provider/i.test(messages)
  ) {
    return new Error(
      `No AWS credentials found while trying to ${action}. Configure a profile, environment credentials, or SSO, then retry.`,
      { cause: error },
    );
  }

  if (names.some((name) => name === "ExpiredToken" || name === "ExpiredTokenException")) {
    return new Error(
      `AWS credentials have expired while trying to ${action}. Re-authenticate and retry.`,
      { cause: error },
    );
  }

  if (
    names.some((name) =>
      [
        "AccessDenied",
        "AccessDeniedException",
        "AuthorizationError",
        "UnauthorizedOperation",
      ].includes(name),
    )
  ) {
    return new Error(
      `AWS denied permission while trying to ${action}. The read-only discovery commands need tag:GetResources, account:ListRegions, cloudfront:GetDistribution, and apigateway:GetApi, GetStages, GetDomainNames, and GetApiMappings.`,
      { cause: error },
    );
  }

  if (names.some((name) => name === "UnrecognizedClientException")) {
    return new Error(
      `AWS did not recognize the credentials while trying to ${action}. Check the access key and region, then retry.`,
      { cause: error },
    );
  }

  return error instanceof Error ? error : new Error(String(error));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
