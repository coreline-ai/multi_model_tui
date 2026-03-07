import dotenv from "dotenv";
import { loadConfig } from "../config.js";
import { startRepl } from "../tui/repl.js";

dotenv.config();

async function main(): Promise<void> {
  await startRepl(loadConfig());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
