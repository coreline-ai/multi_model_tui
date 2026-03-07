import type { AppConfig, AuthStatus } from "../types.js";
import { getClaudeOAuthToken } from "../auth/claude.js";
import { BaseProvider, HttpStatusError } from "./base.js";
import { readResponseBody } from "../utils/http.js";
import { commandExists, extractJsonPayload, runCliCommand } from "../utils/cli.js";

type ClaudeResponse = {
  content?: Array<{ type?: string; text?: string }>;
};

type ClaudeCliResponse = {
  result?: string;
};

export class ClaudeProvider extends BaseProvider {
  readonly name = "claude" as const;
  readonly model: string;

  constructor(private readonly config: AppConfig) {
    super();
    this.model = config.claudeModel;
  }

  async checkAuth(): Promise<AuthStatus> {
    if (getClaudeOAuthToken(this.config.claudeToken)) {
      return { ok: true, detail: "ok" };
    }

    return (await commandExists("claude")) ? { ok: true, detail: "ok" } : { ok: false, detail: "missing-token" };
  }

  protected async runPrompt(prompt: string): Promise<string> {
    const token = getClaudeOAuthToken(this.config.claudeToken);
    if (!token) {
      return this.runClaudeCli(prompt);
    }

    try {
      const response = await fetch(`${this.config.claudeBaseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 4096,
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          stream: false,
        }),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });

      if (!response.ok) {
        throw new HttpStatusError("claude request failed", response.status, await readResponseBody(response));
      }

      const payload = (await response.json()) as ClaudeResponse;
      const text = (payload.content ?? [])
        .filter((item) => item.type === "text" && typeof item.text === "string")
        .map((item) => item.text as string)
        .join("\n");

      return text;
    } catch (error) {
      if (error instanceof HttpStatusError || error instanceof Error) {
        return this.runClaudeCli(prompt);
      }
      throw error;
    }
  }

  private async runClaudeCli(prompt: string): Promise<string> {
    const { stdout } = await runCliCommand(
      "claude",
      ["-p", prompt, "--output-format", "json", "--permission-mode", "plan", "--tools", ""],
      this.config.requestTimeoutMs,
      process.cwd(),
      true
    );

    const payload = extractJsonPayload<ClaudeCliResponse>(stdout);
    if (!payload?.result) {
      throw new Error("invalid provider response");
    }

    return payload.result;
  }
}
