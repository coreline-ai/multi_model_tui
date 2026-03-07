import test from "node:test";
import assert from "node:assert/strict";
import { anthropicToUnified, unifiedToAnthropic } from "../../src/proxy/mapper-anthropic.js";
import { openAiToUnified, unifiedToChatCompletion, unifiedToOpenAiResponse } from "../../src/proxy/mapper-openai.js";

test("anthropic mapper preserves tool and image blocks", () => {
  const mapped = anthropicToUnified({
    model: "claude-sonnet-4-5",
    system: [{ type: "text", text: "be concise" }],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "look at this" },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: "abc123",
            },
          },
        ],
      },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "tool_1", name: "lookup", input: { q: "hello" } }],
      },
    ],
  });

  assert.equal(mapped.provider, "claude");
  assert.equal(mapped.system, "be concise");
  assert.equal(mapped.messages?.[0]?.parts[1]?.type, "image");
  assert.equal(mapped.messages?.[1]?.parts[0]?.type, "tool_call");
});

test("openai mapper preserves tool calls and json response format", () => {
  const mapped = openAiToUnified({
    model: "gpt-5",
    messages: [
      { role: "developer", content: "JSON only" },
      {
        role: "assistant",
        content: "calling tool",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "lookup", arguments: "{\"q\":\"hello\"}" },
          },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      name: "reply",
      schema: { type: "object", properties: { answer: { type: "string" } } },
      strict: true,
    },
  });

  assert.equal(mapped.provider, "codex");
  assert.equal(mapped.messages?.[1]?.parts[1]?.type, "tool_call");
  assert.equal(mapped.responseFormat?.type, "json_schema");
});

test("compatibility mappers preserve hosted tools", () => {
  const anthropicMapped = anthropicToUnified({
    model: "claude-sonnet-4-5",
    tools: [{ type: "web_search_20250305" }, { type: "computer_20250124" }],
    messages: [{ role: "user", content: "search this" }],
    human_input_mode: "return",
  });

  assert.equal(anthropicMapped.hostedTools?.[0]?.type, "web_search");
  assert.equal(anthropicMapped.hostedTools?.[1]?.type, "computer_use");
  assert.equal(anthropicMapped.humanInputMode, "return");

  const openAiMapped = openAiToUnified({
    model: "gpt-5",
    tools: [{ type: "web_search_preview" }, { type: "computer_use_preview" }],
    messages: [{ role: "user", content: "search this" }],
    human_input_mode: "return",
  });

  assert.equal(openAiMapped.hostedTools?.[0]?.type, "web_search");
  assert.equal(openAiMapped.hostedTools?.[1]?.type, "computer_use");
  assert.equal(openAiMapped.humanInputMode, "return");
});

test("compatibility response mappers expose tool calls", () => {
  const anthropic = unifiedToAnthropic({
    provider: "claude",
    ok: true,
    model: "claude-sonnet-4-5",
    transport: "api",
    elapsedMs: 1,
    text: "",
    parts: [{ type: "tool_call", id: "call_1", name: "lookup", argumentsJson: "{\"q\":\"hello\"}" }],
    finishReason: "tool_call",
  });

  assert.equal((anthropic.content as Array<{ type: string }>)[0]?.type, "tool_use");

  const chat = unifiedToChatCompletion({
    provider: "codex",
    ok: true,
    model: "gpt-5",
    transport: "direct",
    elapsedMs: 1,
    text: "",
    parts: [{ type: "tool_call", id: "call_1", name: "lookup", argumentsJson: "{\"q\":\"hello\"}" }],
    finishReason: "tool_call",
  });

  const firstChoice = ((chat.choices as Array<{ message: { tool_calls: Array<{ function: { name: string } }> } }>)[0]);
  assert.equal(firstChoice.message.tool_calls[0].function.name, "lookup");

  const response = unifiedToOpenAiResponse({
    provider: "codex",
    ok: true,
    model: "gpt-5",
    transport: "direct",
    elapsedMs: 1,
    text: "",
    parts: [{ type: "tool_call", id: "call_1", name: "lookup", argumentsJson: "{\"q\":\"hello\"}" }],
    finishReason: "tool_call",
  });

  assert.equal((response.output as Array<{ type: string }>)[1]?.type, "function_call");
});
