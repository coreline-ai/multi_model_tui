import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { extname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "../config.js";
import { spawnNodeModule } from "../shared/process.js";

dotenv.config();

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep polling.
    }
    await delay(250);
  }
  throw new Error(`proxy startup timeout: ${timeoutMs}ms`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const currentFile = fileURLToPath(import.meta.url);
  const extension = extname(currentFile) === ".ts" ? "ts" : "js";
  const proxyEntry = fileURLToPath(new URL(`./proxy.${extension}`, import.meta.url));
  const tuiEntry = fileURLToPath(new URL(`./tui.${extension}`, import.meta.url));

  const proxy = spawnNodeModule(proxyEntry, extension);

  const terminate = (): void => {
    if (!proxy.killed) proxy.kill("SIGTERM");
  };

  process.on("SIGINT", terminate);
  process.on("SIGTERM", terminate);

  await waitForHealth(`http://${config.proxyHost}:${config.proxyPort}/api/v1/health`, config.proxyStartupTimeoutMs);

  const tui = spawnNodeModule(tuiEntry, extension);
  tui.on("exit", (code) => {
    terminate();
    process.exitCode = code ?? 0;
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
