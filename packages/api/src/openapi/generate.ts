import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { renderOpenApiDocument } from "./document.ts";

const CHECK_FLAG = "--check";
const target = fileURLToPath(new URL("../../../../openapi.json", import.meta.url));

async function main(): Promise<void> {
  const generated = await renderOpenApiDocument();

  if (!process.argv.includes(CHECK_FLAG)) {
    await writeFile(target, generated, "utf8");
    console.log(`Wrote ${target}`);
    return;
  }

  const committed = await readFile(target, "utf8").catch(() => undefined);
  if (committed !== generated) {
    console.error(
      "openapi.json is out of date with the route definitions. Run npm run openapi:generate and commit the result.",
    );
    process.exitCode = 1;
    return;
  }
  console.log("openapi.json matches the generated API document.");
}

await main();
