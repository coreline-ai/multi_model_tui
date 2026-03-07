import type { ProviderCapabilityReport, ProviderResult, ProviderStatus, SelfTestResponse } from "../types.js";
import { PROVIDER_ORDER } from "../types.js";

function formatError(error: ProviderResult["error"]): string {
  if (!error) return "unknown error";
  return typeof error === "string" ? error : `${error.code} - ${error.message}`;
}

function providerLabel(provider: string): string {
  return provider.toUpperCase();
}

export function formatHelp(): string {
  return "commands: /codex /gemini /claude /all /status /self-test /help /exit";
}

export function formatStartup(statuses: ProviderStatus[]): string {
  const ready = PROVIDER_ORDER.map((provider) => {
    const status = statuses.find((entry) => entry.provider === provider);
    return `${provider}=${status?.availability ?? "unknown"}`;
  }).join(" ");

  return `Multi Model TUI\nready: ${ready}\n${formatHelp()}\n`;
}

export function formatStatus(statuses: ProviderStatus[], capabilities: ProviderCapabilityReport[] = []): string {
  return statuses
    .map((status) => {
      const report = capabilities.find((entry) => entry.provider === status.provider);
      const effective = report?.transports[0];
      const capabilitySummary = effective
        ? `capabilities=msg:${effective.features.messages.effective},tool:${effective.features.toolCalling.effective},json:${effective.features.structuredOutput.effective},img:${effective.features.imageInput.effective}`
        : null;
      const details = [
        `[${status.provider}] availability=${status.availability}`,
        status.primaryTransport ? `primary=${status.primaryTransport}` : null,
        status.fallbackTransport ? `fallback=${status.fallbackTransport}` : null,
        status.reason ? `reason=${status.reason}` : null,
        capabilitySummary,
      ].filter(Boolean);

      return details.join(" ");
    })
    .join("\n");
}

export function formatSingleResult(result: ProviderResult): string {
  const transport = result.transport ? ` transport=${result.transport}` : "";
  const header = `[${result.provider}] model=${result.model}${transport} elapsed=${result.elapsedMs}ms`;
  if (!result.ok) {
    return `${header}\nERROR: ${formatError(result.error)}`;
  }
  return `${header}\n${result.text || "(empty response)"}`;
}

export function formatAllResults(results: ProviderResult[]): string {
  const byProvider = new Map(results.map((result) => [result.provider, result]));

  return PROVIDER_ORDER.map((provider) => {
    const result = byProvider.get(provider);
    if (!result) {
      return `=== ${providerLabel(provider)} ===\nstatus: error\nerror:\nmissing result`;
    }

    if (!result.ok) {
      return [
        `=== ${providerLabel(provider)} ===`,
        "status: error",
        `model: ${result.model}`,
        result.transport ? `transport: ${result.transport}` : null,
        `elapsed_ms: ${result.elapsedMs}`,
        "error:",
        formatError(result.error),
      ]
        .filter(Boolean)
        .join("\n");
    }

    return [
      `=== ${providerLabel(provider)} ===`,
      "status: ok",
      `model: ${result.model}`,
      result.transport ? `transport: ${result.transport}` : null,
      `elapsed_ms: ${result.elapsedMs}`,
      "content:",
      result.text || "(empty response)",
    ]
      .filter(Boolean)
      .join("\n");
  }).join("\n\n");
}

export function formatSelfTest(result: SelfTestResponse): string {
  return result.results
    .map((entry) =>
      [
        `=== ${providerLabel(entry.provider)} ===`,
        `ok: ${entry.ok}`,
        entry.transport ? `transport: ${entry.transport}` : null,
        `expected: ${entry.expected}`,
        `actual: ${entry.actual || "(empty)"}`,
        entry.error ? `error: ${entry.error.code} - ${entry.error.message}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");
}
