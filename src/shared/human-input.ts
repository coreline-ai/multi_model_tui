import type { HostedToolConfig, HumanInputRequest, UnifiedRequest } from "../types.js";

const INTERACTIVE_HOSTED_TOOLS = new Set<HostedToolConfig["type"]>(["computer_use", "remote_mcp"]);

function buildInstructions(tool: HostedToolConfig): string {
  if (tool.type === "computer_use") {
    return "This request includes computer_use. An operator must approve and supervise the action before execution can continue.";
  }

  if (tool.type === "remote_mcp") {
    return "This request includes remote_mcp. Review the requested remote connector permissions and approve them manually before retrying.";
  }

  return "This request requires human input before execution can continue.";
}

export function getHumanInputRequirement(req: UnifiedRequest): HumanInputRequest | undefined {
  const tool = req.hostedTools?.find((entry) => INTERACTIVE_HOSTED_TOOLS.has(entry.type));
  if (!tool) {
    return undefined;
  }

  return {
    kind: "approval",
    title: `Human approval required for ${tool.type}`,
    instructions: buildInstructions(tool),
    provider: req.provider,
    toolType: tool.type,
    resumable: false,
  };
}

export function shouldReturnHumanInput(req: UnifiedRequest): boolean {
  return req.humanInputMode === "return";
}
