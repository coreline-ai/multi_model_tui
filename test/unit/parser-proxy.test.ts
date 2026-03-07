import test from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "../../src/tui/parser.js";

test("parses status command", () => {
  assert.deepEqual(parseCommand("/status"), {
    kind: "status",
    raw: "/status",
  });
});

test("parses self-test command", () => {
  assert.deepEqual(parseCommand("/self-test"), {
    kind: "self-test",
    raw: "/self-test",
  });
});
