import type { Express, Request, Response } from "express";
import type { ProxyRouter } from "./router.js";
import { openAiToUnified, unifiedToChatCompletion, unifiedToOpenAiResponse } from "./mapper-openai.js";
import { formatSseEvent } from "../shared/sse.js";
import type { FinishReason, NormalizedContentPart, UnifiedChunk } from "../types.js";

function sendOpenAiError(res: Response, message: string, status = 400, humanInput?: unknown): void {
  res.status(status).json({
    error: {
      message,
      type: "invalid_request_error",
    },
    ...(humanInput ? { human_input: humanInput } : {}),
  });
}

function toOpenAiFinishReason(reason: FinishReason | undefined): string | null {
  if (reason === "tool_call") return "tool_calls";
  if (reason === "max_tokens") return "length";
  if (reason === "error") return "error";
  return "stop";
}

function writeChatCompletionChunk(
  res: Response,
  model: string | undefined,
  created: number,
  delta: Record<string, unknown>,
  finishReason: string | null,
  usage?: UnifiedChunk["usage"]
): void {
  res.write(
    formatSseEvent("message", {
      id: `chatcmpl_${Date.now()}`,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [
        {
          index: 0,
          delta,
          finish_reason: finishReason,
        },
      ],
      ...(usage
        ? {
            usage: {
              prompt_tokens: usage.inputTokens ?? 0,
              completion_tokens: usage.outputTokens ?? 0,
              total_tokens: usage.totalTokens ?? 0,
            },
          }
        : {}),
    })
  );
}

function writeResponsesPart(res: Response, part: NormalizedContentPart): void {
  if (part.type === "tool_call") {
    res.write(
      formatSseEvent("message", {
        type: "response.output_item.added",
        item: {
          type: "function_call",
          id: part.id,
          call_id: part.id,
          name: part.name,
          arguments: part.argumentsJson,
        },
      })
    );
    res.write(
      formatSseEvent("message", {
        type: "response.output_item.done",
        item: {
          type: "function_call",
          id: part.id,
          call_id: part.id,
          name: part.name,
          arguments: part.argumentsJson,
        },
      })
    );
    return;
  }

  const text =
    part.type === "json"
      ? JSON.stringify(part.value)
      : part.type === "refusal"
        ? part.text
        : part.type === "text"
          ? part.text
          : "";

  if (!text) return;
  res.write(formatSseEvent("message", { type: "response.output_text.delta", delta: text }));
}

export function registerOpenAiRoutes(app: Express, proxyRouter: ProxyRouter): void {
  app.post("/openai/v1/chat/completions", async (req: Request, res: Response) => {
    try {
      const unified = openAiToUnified(req.body as Record<string, unknown>);

      if (unified.stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const created = Math.floor(Date.now() / 1000);
        let started = false;

        for await (const chunk of proxyRouter.stream(unified)) {
          if (!started && chunk.type === "start") {
            started = true;
            writeChatCompletionChunk(res, chunk.model, created, { role: "assistant" }, null);
          }
          if (chunk.type === "delta" && chunk.text) {
            writeChatCompletionChunk(res, chunk.model, created, { content: chunk.text }, null);
          }
          if (chunk.part?.type === "tool_call") {
            writeChatCompletionChunk(
              res,
              chunk.model,
              created,
              {
                tool_calls: [
                  {
                    index: 0,
                    id: chunk.part.id,
                    type: "function",
                    function: {
                      name: chunk.part.name,
                      arguments: chunk.part.argumentsJson,
                    },
                  },
                ],
              },
              null
            );
          }
          if (chunk.part?.type === "json") {
            writeChatCompletionChunk(res, chunk.model, created, { content: JSON.stringify(chunk.part.value) }, null);
          }
          if (chunk.type === "end") {
            writeChatCompletionChunk(
              res,
              chunk.model,
              created,
              {},
              toOpenAiFinishReason(chunk.finishReason),
              chunk.usage
            );
          }
          if (chunk.type === "error" && chunk.error) {
            res.write(
              formatSseEvent("message", {
                error: chunk.error,
                ...(chunk.humanInput ? { human_input: chunk.humanInput } : {}),
              })
            );
          }
        }
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      const response = await proxyRouter.execute(unified);
      if (!response.ok) {
        sendOpenAiError(
          res,
          response.error?.message ?? "provider error",
          response.error?.code === "human_input_required" ? 409 : 502,
          response.humanInput
        );
        return;
      }

      res.json(unifiedToChatCompletion(response));
    } catch (error) {
      sendOpenAiError(res, error instanceof Error ? error.message : String(error));
    }
  });

  app.post("/openai/v1/responses", async (req: Request, res: Response) => {
    try {
      const unified = openAiToUnified(req.body as Record<string, unknown>);

      if (unified.stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        for await (const chunk of proxyRouter.stream(unified)) {
          if (chunk.type === "start") {
            res.write(
              formatSseEvent("message", {
                type: "response.created",
                response: {
                  id: `resp_${Date.now()}`,
                  object: "response",
                  model: chunk.model,
                },
              })
            );
          }
          if (chunk.type === "delta" && chunk.text) {
            writeResponsesPart(res, { type: "text", text: chunk.text });
          }
          if (chunk.part) {
            writeResponsesPart(res, chunk.part);
          }
          if (chunk.type === "end") {
            res.write(
              formatSseEvent("message", {
                type: "response.completed",
                response: {
                  id: `resp_${Date.now()}`,
                  object: "response",
                  model: chunk.model,
                  usage: {
                    input_tokens: chunk.usage?.inputTokens ?? 0,
                    output_tokens: chunk.usage?.outputTokens ?? 0,
                    total_tokens: chunk.usage?.totalTokens ?? 0,
                  },
                },
              })
            );
          }
          if (chunk.type === "error" && chunk.error) {
            res.write(
              formatSseEvent("message", {
                type: "response.error",
                error: chunk.error,
                ...(chunk.humanInput ? { human_input: chunk.humanInput } : {}),
              })
            );
          }
        }
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      const response = await proxyRouter.execute(unified);
      if (!response.ok) {
        sendOpenAiError(
          res,
          response.error?.message ?? "provider error",
          response.error?.code === "human_input_required" ? 409 : 502,
          response.humanInput
        );
        return;
      }

      res.json(unifiedToOpenAiResponse(response));
    } catch (error) {
      sendOpenAiError(res, error instanceof Error ? error.message : String(error));
    }
  });
}
