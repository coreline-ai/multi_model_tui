import { homedir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "./types.js";

function expandHomePath(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseLogLevel(value: string | undefined): AppConfig["proxyLogLevel"] {
  if (value === "debug" || value === "error") return value;
  return "info";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    codexModel: env.TUI_CODEX_MODEL ?? "gpt-5",
    geminiModel: env.TUI_GEMINI_MODEL ?? "gemini-2.5-pro",
    claudeModel: env.TUI_CLAUDE_MODEL ?? "claude-sonnet-4-5",
    geminiProject: env.TUI_GEMINI_PROJECT || undefined,
    claudeToken: env.CLAUDE_CODE_OAUTH_TOKEN || undefined,
    codexBaseUrl: env.CODEX_BASE_URL ?? "https://chatgpt.com/backend-api",
    claudeBaseUrl: env.CLAUDE_BASE_URL ?? "https://api.anthropic.com",
    codexAuthPath: expandHomePath(env.CODEX_AUTH_PATH, join(homedir(), ".codex", "auth.json")),
    codexFallbackAuthPath: join(homedir(), ".chatgpt-codex-proxy", "tokens.json"),
    geminiAuthPath: expandHomePath(env.GEMINI_AUTH_PATH, join(homedir(), ".gemini", "oauth_creds.json")),
    requestTimeoutMs: 60_000,
    proxyHost: env.TUI_PROXY_HOST ?? "127.0.0.1",
    proxyPort: parsePort(env.TUI_PROXY_PORT, 4317),
    proxyLogLevel: parseLogLevel(env.TUI_PROXY_LOG_LEVEL),
    proxyStartupTimeoutMs: parsePort(env.TUI_PROXY_STARTUP_TIMEOUT_MS, 10_000),
  };
}
