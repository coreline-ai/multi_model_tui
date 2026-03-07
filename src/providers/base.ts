import type { AuthStatus, ProviderClient, ProviderName, ProviderResult } from "../types.js";
import { elapsedMs, nowMs } from "../utils/time.js";

export class HttpStatusError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly bodyText?: string
  ) {
    super(message);
    this.name = "HttpStatusError";
  }
}

export function normalizeProviderError(error: unknown): string {
  if (error instanceof HttpStatusError) {
    if (error.status === 401) return "auth invalid or expired";
    if (error.status === 403) return error.bodyText ? `request denied: ${error.bodyText}` : "request denied";
    if (error.status === 429) return "rate limited";
    return error.bodyText ? `request failed: ${error.bodyText}` : `request failed: http ${error.status}`;
  }

  if (error instanceof Error) {
    if (error.name === "AbortError") return "timeout";
    return error.message;
  }

  return "unknown error";
}

export abstract class BaseProvider implements ProviderClient {
  abstract readonly name: ProviderName;
  abstract readonly model: string;

  abstract checkAuth(): Promise<AuthStatus>;

  async sendPrompt(prompt: string): Promise<ProviderResult> {
    const startedAt = nowMs();

    try {
      const text = await this.runPrompt(prompt);
      return {
        provider: this.name,
        ok: true,
        model: this.model,
        elapsedMs: elapsedMs(startedAt),
        text,
      };
    } catch (error) {
      return {
        provider: this.name,
        ok: false,
        model: this.model,
        elapsedMs: elapsedMs(startedAt),
        text: "",
        error: normalizeProviderError(error),
      };
    }
  }

  protected abstract runPrompt(prompt: string): Promise<string>;
}
