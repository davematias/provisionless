import { createInterface, type Interface } from "node:readline/promises";

export type Ask = (question: string) => Promise<string>;

export interface Prompter {
  ask: Ask;
  close: () => void;
}

export function createPrompter(): Prompter {
  let readline: Interface | undefined;

  return {
    ask: (question: string) => {
      readline ??= createInterface({ input: process.stdin, output: process.stdout });
      return readline.question(question);
    },
    close: () => {
      readline?.close();
    },
  };
}

export async function confirm(ask: Ask, question: string, defaultValue: boolean): Promise<boolean> {
  const suffix = defaultValue ? " [Y/n] " : " [y/N] ";
  const answer = (await ask(`${question}${suffix}`)).trim().toLowerCase();
  if (answer === "") {
    return defaultValue;
  }
  return answer === "y" || answer === "yes";
}
