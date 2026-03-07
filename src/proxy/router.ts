import type {
  AppConfig,
  ProviderCapabilityReport,
  ProviderAdapter,
  ProviderName,
  ProviderStatus,
  SelfTestRequest,
  SelfTestResponse,
  UnifiedBatchRequest,
  UnifiedChunk,
  UnifiedRequest,
  UnifiedResponse,
} from "../types.js";
import { PROVIDER_ORDER } from "../types.js";
import { humanInputRequiredError, toUnifiedError, UnifiedProxyError } from "../shared/errors.js";
import { getHumanInputRequirement, shouldReturnHumanInput } from "../shared/human-input.js";
import { CodexAdapter } from "../providers/codex/adapter.js";
import { ClaudeAdapter } from "../providers/claude/adapter.js";
import { GeminiAdapter } from "../providers/gemini/adapter.js";

export interface ProxyRouter {
  getStatuses(): Promise<ProviderStatus[]>;
  getCapabilities(provider?: ProviderName): Promise<ProviderCapabilityReport[]>;
  execute(req: UnifiedRequest): Promise<UnifiedResponse>;
  batch(req: UnifiedBatchRequest): Promise<UnifiedResponse[]>;
  stream(req: UnifiedRequest): AsyncGenerator<UnifiedChunk>;
  selfTest(req: SelfTestRequest): Promise<SelfTestResponse>;
}

function fixedPrompt(provider: ProviderName): string {
  if (provider === "codex") return "reply with exactly: codex ok";
  if (provider === "claude") return "reply with exactly: claude ok";
  return "reply with exactly: gemini ok";
}

function fixedExpected(provider: ProviderName): string {
  return provider === "codex" ? "codex ok" : provider === "claude" ? "claude ok" : "gemini ok";
}

export function createProviderAdapters(config: AppConfig): Record<ProviderName, ProviderAdapter> {
  return {
    codex: new CodexAdapter(config),
    claude: new ClaudeAdapter(config),
    gemini: new GeminiAdapter(config),
  };
}

export function createProxyRouter(adapters: Record<ProviderName, ProviderAdapter>): ProxyRouter {
  return {
    async getStatuses(): Promise<ProviderStatus[]> {
      const statuses = await Promise.all(PROVIDER_ORDER.map((provider) => adapters[provider].getStatus()));
      return statuses;
    },
    async getCapabilities(provider?: ProviderName): Promise<ProviderCapabilityReport[]> {
      const names = provider ? [provider] : PROVIDER_ORDER;
      return Promise.all(names.map((name) => adapters[name].getCapabilities()));
    },
    execute(req: UnifiedRequest): Promise<UnifiedResponse> {
      return executeAdapter(adapters[req.provider], req);
    },
    async batch(req: UnifiedBatchRequest): Promise<UnifiedResponse[]> {
      const results = await Promise.all(
        req.providers.map((provider) =>
          executeAdapter(adapters[provider], {
            provider,
            prompt: req.prompt,
            messages: req.messages,
            stream: req.stream,
            timeoutMs: req.timeoutMs,
            metadata: req.metadata,
            system: req.system,
            maxTokens: req.maxTokens,
            maxOutputTokens: req.maxOutputTokens,
            temperature: req.temperature,
            tools: req.tools,
            hostedTools: req.hostedTools,
            toolChoice: req.toolChoice,
            responseFormat: req.responseFormat,
            state: req.state,
            capabilityPolicy: req.capabilityPolicy,
            humanInputMode: req.humanInputMode,
          })
        )
      );

      return PROVIDER_ORDER.map((provider) => results.find((result) => result.provider === provider)).filter(
        Boolean
      ) as UnifiedResponse[];
    },
    stream(req: UnifiedRequest): AsyncGenerator<UnifiedChunk> {
      return streamAdapter(adapters[req.provider], req);
    },
    async selfTest(req: SelfTestRequest): Promise<SelfTestResponse> {
      const results = await Promise.all(
        req.providers.map(async (provider) => {
          const response = await executeAdapter(adapters[provider], {
            provider,
            prompt: fixedPrompt(provider),
          });

          return {
            provider,
            ok: response.ok && response.text.trim() === fixedExpected(provider),
            expected: fixedExpected(provider),
            actual: response.text.trim(),
            transport: response.transport,
            error: response.error,
          };
        })
      );

      return {
        results: PROVIDER_ORDER.map((provider) => results.find((result) => result.provider === provider)).filter(
          Boolean
        ) as SelfTestResponse["results"],
      };
    },
  };
}

async function executeAdapter(adapter: ProviderAdapter, req: UnifiedRequest): Promise<UnifiedResponse> {
  try {
    const humanInput = getHumanInputRequirement(req);
    if (humanInput) {
      if (shouldReturnHumanInput(req)) {
        return {
          provider: adapter.provider,
          ok: false,
          model: req.model ?? adapter.provider,
          transport: "none",
          elapsedMs: 0,
          text: "",
          error: {
            code: "human_input_required",
            message: humanInput.instructions,
            transport: "none",
            feature: "hostedTools",
          },
          humanInput,
        };
      }
      throw humanInputRequiredError(humanInput);
    }

    return await adapter.execute(req);
  } catch (error) {
    const humanInput = error instanceof UnifiedProxyError ? error.humanInput : undefined;
    return {
      provider: adapter.provider,
      ok: false,
      model: req.model ?? adapter.provider,
      transport: "none",
      elapsedMs: 0,
      text: "",
      error: toUnifiedError(error),
      ...(humanInput ? { humanInput } : {}),
    };
  }
}

async function* streamAdapter(adapter: ProviderAdapter, req: UnifiedRequest): AsyncGenerator<UnifiedChunk> {
  try {
    const humanInput = getHumanInputRequirement(req);
    if (humanInput) {
      if (shouldReturnHumanInput(req)) {
        yield {
          provider: adapter.provider,
          type: "error",
          model: req.model,
          transport: "none",
          error: {
            code: "human_input_required",
            message: humanInput.instructions,
            transport: "none",
            feature: "hostedTools",
          },
          humanInput,
          done: true,
        };
        return;
      }
      throw humanInputRequiredError(humanInput);
    }

    for await (const chunk of adapter.stream(req)) {
      yield chunk;
    }
  } catch (error) {
    const humanInput = error instanceof UnifiedProxyError ? error.humanInput : undefined;
    yield {
      provider: adapter.provider,
      type: "error",
      model: req.model,
      transport: "none",
      error: toUnifiedError(error),
      ...(humanInput ? { humanInput } : {}),
      done: true,
    };
  }
}
