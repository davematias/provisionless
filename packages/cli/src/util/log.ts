export type Logger = (message: string) => void;

export function createLogger(prefix = "provisionless"): Logger {
  return (message: string) => {
    process.stdout.write(`[${prefix}] ${message}\n`);
  };
}
