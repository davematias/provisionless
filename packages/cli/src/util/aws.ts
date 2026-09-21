export function isAwsError(error: unknown, name: string): boolean {
  return typeof error === "object" && error !== null && (error as { name?: string }).name === name;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
