import test from "node:test";
import assert from "node:assert/strict";
import { extractJsonPayload, stripAnsi } from "../src/utils/cli.js";

test("strips ansi escape sequences", () => {
  assert.equal(stripAnsi("\u001b[31mhello\u001b[0m"), "hello");
});

test("extracts plain json payload", () => {
  assert.deepEqual(extractJsonPayload<{ value: string }>('{ "value": "ok" }'), { value: "ok" });
});

test("extracts json payload with noisy prefix", () => {
  const output = "Loaded cached credentials.\nError during discovery\n{\n  \"response\": \"gemini ok\"\n}";
  assert.deepEqual(extractJsonPayload<{ response: string }>(output), { response: "gemini ok" });
});
