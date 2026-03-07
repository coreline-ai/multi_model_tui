import test from "node:test";
import assert from "node:assert/strict";
import { parseRichUnifiedBatchRequest, parseRichUnifiedRequest } from "../../src/proxy/contracts.js";

test("parses rich unified request with messages and response format", () => {
  const parsed = parseRichUnifiedRequest({
    provider: "claude",
    messages: [
      {
        role: "system",
        parts: [{ type: "text", text: "Answer in JSON." }],
      },
      {
        role: "user",
        parts: [{ type: "text", text: "hello" }],
      },
    ],
    tools: [
      {
        name: "lookup",
        inputSchema: { type: "object", properties: { q: { type: "string" } } },
      },
    ],
    responseFormat: {
      type: "json_schema",
      name: "hello_response",
      schema: { type: "object", properties: { greeting: { type: "string" } } },
      strict: true,
    },
  });

  assert.equal(parsed.provider, "claude");
  assert.equal(parsed.messages?.length, 2);
  assert.equal(parsed.messages?.[0]?.role, "system");
  assert.equal(parsed.tools?.[0]?.name, "lookup");
  assert.equal(parsed.responseFormat?.type, "json_schema");
});

test("parses rich batch request with shared messages", () => {
  const parsed = parseRichUnifiedBatchRequest({
    providers: ["codex", "gemini"],
    messages: [{ role: "user", parts: [{ type: "text", text: "batch hello" }] }],
    system: "shared system",
  });

  assert.deepEqual(parsed.providers, ["codex", "gemini"]);
  assert.equal(parsed.messages?.[0]?.parts[0]?.type, "text");
  assert.equal(parsed.system, "shared system");
});

test("parses human input mode and hosted tools", () => {
  const parsed = parseRichUnifiedRequest({
    provider: "claude",
    messages: [{ role: "user", parts: [{ type: "text", text: "browse" }] }],
    hostedTools: [{ type: "web_search" }, { type: "computer_use" }],
    humanInputMode: "return",
  });

  assert.equal(parsed.humanInputMode, "return");
  assert.equal(parsed.hostedTools?.length, 2);
  assert.equal(parsed.hostedTools?.[1]?.type, "computer_use");
});
