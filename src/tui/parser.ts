import type { ParsedCommand } from "../types.js";

const PROVIDER_COMMANDS = new Set(["/codex", "/gemini", "/claude", "/all"]);

export function parseCommand(input: string): ParsedCommand {
  const raw = input;
  const trimmed = input.trim();

  if (!trimmed) {
    return { kind: "invalid", raw, error: "command is required" };
  }

  if (!trimmed.startsWith("/")) {
    return { kind: "invalid", raw, error: "commands must start with /" };
  }

  if (trimmed === "/help") return { kind: "help", raw };
  if (trimmed === "/exit") return { kind: "exit", raw };
  if (trimmed === "/status") return { kind: "status", raw };
  if (trimmed === "/self-test") return { kind: "self-test", raw };

  const firstSpace = trimmed.indexOf(" ");
  const command = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  const prompt = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();

  if (!PROVIDER_COMMANDS.has(command)) {
    return { kind: "invalid", raw, error: "unknown command" };
  }

  if (!prompt) {
    return { kind: "invalid", raw, error: "prompt is required" };
  }

  return {
    kind: "provider",
    raw,
    provider: command.slice(1) as ParsedCommand["provider"],
    prompt,
  };
}
