import dotenv from "dotenv";
import { loadConfig } from "../config.js";
import { createProxyServer } from "../proxy/server.js";

dotenv.config();

async function main(): Promise<void> {
  const server = createProxyServer(loadConfig());
  const handle = await server.listen();

  const shutdown = async (): Promise<void> => {
    await handle.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
