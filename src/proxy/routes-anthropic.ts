import type { Express, Request, Response } from "express";
import type { ProxyRouter } from "./router.js";
import { anthropicToUnified, unifiedToAnthropic } from "./mapper-anthropic.js";
import { formatSseEvent } from "../shared/sse.js";
import type { FinishReason, NormalizedContentPart, UnifiedChunk } from "../types.js";

function sendAnthropicError(res: Response, message: string, status = 400, humanInput?: unknown): void {
  res.status(status).json({
    type: "error",
    error: {
      type: "invalid_request_error",
      message,
    },
    ...(humanInput ? { human_input: humanInput } : {}),
  });
}

function toAnthropicStopReason(reason: FinishReason | undefined): string | null {
  if (reason === "tool_call") return "tool_use";
  if (reason === "max_tokens") return "max_tokens";
  return "end_turn";
}

function emitAnthropicContentPart(res: Response, index: number, part: NormalizedContentPart): void {
  if (part.type === "tool_call") {
    res.write(
      formatSseEvent("content_block_start", {
        type: "content_block_start",
        index,
        content_block: {
          type: "tool_use",
          id: part.id,
          name: part.name,
          input: {},
        },
      })
    );
    res.write(
      formatSseEvent("content_block_delta", {
        type: "content_block_delta",
        index,
        delta: { type: "input_json_delta", partial_json: part.argumentsJson },
      })
    );
    res.write(formatSseEvent("content_block_stop", { type: "content_block_stop", index }));
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

  res.write(
    formatSseEvent("content_block_start", {
      type: "content_block_start",
      index,
      content_block: { type: "text", text: "" },
    })
  );
  if (text) {
    res.write(
      formatSseEvent("content_block_delta", {
        type: "content_block_delta",
        index,
        delta: { type: "text_delta", text },
      })
    );
  }
  res.write(formatSseEvent("content_block_stop", { type: "content_block_stop", index }));
}

export function registerAnthropicRoutes(app: Express, proxyRouter: ProxyRouter): void {
  app.post("/anthropic/v1/messages", async (req: Request, res: Response) => {
    try {
      const unified = anthropicToUnified(req.body as Record<string, unknown>);

      if (unified.stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const messageStart = {
          type: "message_start",
          message: {
            id: `msg_${Date.now()}`,
            type: "message",
            role: "assistant",
            model: unified.model,
            content: [],
          },
        };
        res.write(formatSseEvent("message_start", messageStart));

        let nextIndex = 0;
        let textBlockIndex: number | null = null;
        let emittedAnyBlock = false;
        let finishReason: FinishReason | undefined;
        let usage: UnifiedChunk["usage"];

        const ensureTextBlock = (): number => {
          if (textBlockIndex !== null) return textBlockIndex;
          textBlockIndex = nextIndex++;
          emittedAnyBlock = true;
          res.write(
            formatSseEvent("content_block_start", {
              type: "content_block_start",
              index: textBlockIndex,
              content_block: { type: "text", text: "" },
            })
          );
          return textBlockIndex;
        };

        const closeTextBlock = (): void => {
          if (textBlockIndex === null) return;
          res.write(formatSseEvent("content_block_stop", { type: "content_block_stop", index: textBlockIndex }));
          textBlockIndex = null;
        };

        for await (const chunk of proxyRouter.stream(unified)) {
          if (chunk.type === "delta" && chunk.text) {
            const index = ensureTextBlock();
            res.write(
              formatSseEvent("content_block_delta", {
                type: "content_block_delta",
                index,
                delta: { type: "text_delta", text: chunk.text },
              })
            );
          }
          if (chunk.part) {
            if (chunk.part.type === "text") {
              const index = ensureTextBlock();
              res.write(
                formatSseEvent("content_block_delta", {
                  type: "content_block_delta",
                  index,
                  delta: { type: "text_delta", text: chunk.part.text },
                })
              );
            } else {
              closeTextBlock();
              emittedAnyBlock = true;
              emitAnthropicContentPart(res, nextIndex++, chunk.part);
            }
          }
          if (chunk.type === "error" && chunk.error) {
            res.write(
              formatSseEvent("error", {
                type: "error",
                error: chunk.error,
                ...(chunk.humanInput ? { human_input: chunk.humanInput } : {}),
              })
            );
          }
          if (chunk.type === "end") {
            finishReason = chunk.finishReason;
            usage = chunk.usage;
          }
        }

        if (!emittedAnyBlock) {
          emitAnthropicContentPart(res, nextIndex++, { type: "text", text: "" });
        } else {
          closeTextBlock();
        }
        res.write(
          formatSseEvent("message_delta", {
            type: "message_delta",
            delta: { stop_reason: toAnthropicStopReason(finishReason), stop_sequence: null },
            usage: { output_tokens: usage?.outputTokens ?? 0 },
          })
        );
        res.write(formatSseEvent("message_stop", { type: "message_stop" }));
        res.end();
        return;
      }

      const response = await proxyRouter.execute(unified);
      if (!response.ok) {
        sendAnthropicError(
          res,
          response.error?.message ?? "provider error",
          response.error?.code === "human_input_required" ? 409 : 502,
          response.humanInput
        );
        return;
      }

      res.json(unifiedToAnthropic(response));
    } catch (error) {
      sendAnthropicError(res, error instanceof Error ? error.message : String(error));
    }
  });
}
