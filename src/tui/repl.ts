import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { AppConfig, LocalProxyClient, ProviderResult } from "../types.js";
import { PROVIDER_ORDER } from "../types.js";
import { createLocalProxyClient } from "./client.js";
import {
  formatAllResults,
  formatHelp,
  formatSelfTest,
  formatSingleResult,
  formatStartup,
  formatStatus,
} from "./format.js";
import { parseCommand } from "./parser.js";

function toProviderResult(result: {
  provider: string;
  ok: boolean;
  model: string;
  transport: string;
  elapsedMs: number;
  text: string;
  error?: unknown;
}): ProviderResult {
  return {
    provider: result.provider as ProviderResult["provider"],
    ok: result.ok,
    model: result.model,
    transport: result.transport,
    elapsedMs: result.elapsedMs,
    text: result.text,
    error:
      result.error && typeof result.error === "object" && "message" in (result.error as Record<string, unknown>)
        ? (result.error as ProviderResult["error"])
        : undefined,
  };
}

export async function startRepl(config: AppConfig, client: LocalProxyClient = createLocalProxyClient(config)): Promise<void> {
  const providerStatuses = await client.getProviders();
  console.log(formatStartup(providerStatuses.providers));

  const rl = createInterface({ input, output });

  try {
    while (true) {
      let line: string;
      try {
        line = await rl.question("> ");
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ERR_USE_AFTER_CLOSE") {
          break;
        }
        throw error;
      }

      const parsed = parseCommand(line);
      if (parsed.kind === "exit") {
        break;
      }
      if (parsed.kind === "help") {
        console.log(formatHelp());
        continue;
      }
      if (parsed.kind === "status") {
        const [statuses, capabilities] = await Promise.all([client.getProviders(), client.getCapabilities()]);
        console.log(formatStatus(statuses.providers, capabilities.providers));
        continue;
      }
      if (parsed.kind === "self-test") {
        console.log(formatSelfTest(await client.selfTest({ providers: [...PROVIDER_ORDER] })));
        continue;
      }
      if (parsed.kind === "invalid") {
        console.log(parsed.error === "unknown command" ? `${parsed.error}\n${formatHelp()}` : parsed.error);
        continue;
      }

      if (parsed.provider === "all") {
        const results = await client.batchV2({
          providers: [...PROVIDER_ORDER],
          messages: [{ role: "user", parts: [{ type: "text", text: parsed.prompt! }] }],
        });
        console.log(formatAllResults(results.results.map(toProviderResult)));
        continue;
      }

      const result = await client.chatV2({
        provider: parsed.provider!,
        messages: [{ role: "user", parts: [{ type: "text", text: parsed.prompt! }] }],
        metadata: { source: "tui" },
      });
      console.log(formatSingleResult(toProviderResult(result)));
    }
  } finally {
    rl.close();
  }
}
