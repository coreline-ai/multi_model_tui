import type { AppConfig, AuthStatus } from "../types.js";
import { getValidCodexTokens } from "../auth/codex.js";
import { BaseProvider, HttpStatusError } from "./base.js";
import { parseSseEvents, readResponseBody } from "../utils/http.js";

interface CodexResponseOutputText {
  type?: string;
  text?: string;
}

interface CodexResponseItem {
  content?: CodexResponseOutputText[];
}

interface CodexFinalResponse {
  output?: CodexResponseItem[];
}

function extractFinalText(response: CodexFinalResponse | null): string {
  if (!response?.output) return "";

  return response.output
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text" && typeof content.text === "string")
    .map((content) => content.text as string)
    .join("");
}

export class CodexProvider extends BaseProvider {
  readonly name = "codex" as const;
  readonly model: string;

  constructor(private readonly config: AppConfig) {
    super();
    this.model = config.codexModel;
  }

  async checkAuth(): Promise<AuthStatus> {
    const tokens = await getValidCodexTokens(this.config.codexAuthPath, this.config.codexFallbackAuthPath);
    if (!tokens) {
      return { ok: false, detail: "missing-auth" };
    }
    if (!tokens.accountId) {
      return { ok: false, detail: "missing-account-id" };
    }
    return { ok: true, detail: "ok" };
  }

  protected async runPrompt(prompt: string): Promise<string> {
    const tokens = await getValidCodexTokens(this.config.codexAuthPath, this.config.codexFallbackAuthPath);
    if (!tokens) {
      throw new Error("missing codex auth");
    }
    if (!tokens.accountId) {
      throw new Error("missing codex account id");
    }

    const response = await fetch(`${this.config.codexBaseUrl}/codex/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokens.accessToken}`,
        "chatgpt-account-id": tokens.accountId,
        "OpenAI-Beta": "responses=experimental",
        originator: "codex_cli_rs",
      },
      body: JSON.stringify({
        model: this.model,
        instructions: "",
        input: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: prompt }],
          },
        ],
        stream: true,
        store: false,
        reasoning: { effort: "medium", summary: "auto" },
        text: { verbosity: "medium" },
      }),
      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
    });

    if (!response.ok) {
      throw new HttpStatusError("codex request failed", response.status, await readResponseBody(response));
    }

    if (!response.body) {
      throw new Error("invalid provider response");
    }

    let accumulated = "";
    let finalResponse: CodexFinalResponse | null = null;

    for await (const event of parseSseEvents(response.body)) {
      if (event.data === "[DONE]") {
        break;
      }

      let parsed: { type?: string; delta?: string; response?: CodexFinalResponse };
      try {
        parsed = JSON.parse(event.data) as { type?: string; delta?: string; response?: CodexFinalResponse };
      } catch {
        continue;
      }

      if (parsed.type === "response.output_text.delta" && typeof parsed.delta === "string") {
        accumulated += parsed.delta;
      }

      if ((parsed.type === "response.done" || parsed.type === "response.completed") && parsed.response) {
        finalResponse = parsed.response;
      }
    }

    return extractFinalText(finalResponse) || accumulated;
  }
}
