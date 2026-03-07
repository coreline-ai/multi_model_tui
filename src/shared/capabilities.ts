import type { CapabilityFeature, ProviderCapabilities, ProviderCapabilityReport, ProviderStatus, SupportLevel, UnifiedRequest } from "../types.js";
import { unsupportedFeatureError } from "./errors.js";
import { inferRequestedFeatures } from "./normalized.js";

export function mergeCapabilities(
  status: ProviderStatus,
  transports: ProviderCapabilities[]
): ProviderCapabilityReport {
  const selected =
    (status.primaryTransport && transports.find((transport) => transport.transport === status.primaryTransport)) ??
    transports[0] ??
    null;

  if (!selected) {
    return {
      provider: status.provider,
      availability: status.availability,
      selectedTransport: null,
      transports,
    };
  }

  return {
    provider: status.provider,
    availability: status.availability,
    selectedTransport: status.primaryTransport,
    transports: [selected, ...transports.filter((entry) => entry.transport !== selected.transport)],
  };
}

function featureSupport(capabilities: ProviderCapabilities, feature: CapabilityFeature): SupportLevel {
  const mapping = {
    messages: capabilities.features.messages,
    systemInstruction: capabilities.features.systemInstruction,
    streaming: capabilities.features.streaming,
    usage: capabilities.features.usage,
    toolCalling: capabilities.features.toolCalling,
    hostedTools: capabilities.features.hostedTools,
    imageInput: capabilities.features.imageInput,
    fileInput: capabilities.features.fileInput,
    structuredOutput: capabilities.features.structuredOutput,
    reasoning: capabilities.features.reasoning,
    citations: capabilities.features.citations,
    caching: capabilities.features.caching,
    stateContinuation: capabilities.features.stateContinuation,
  } as const;

  return mapping[feature].transport;
}

export function assertTransportSupportsRequest(req: UnifiedRequest, capabilities: ProviderCapabilities): void {
  for (const feature of inferRequestedFeatures(req)) {
    if (featureSupport(capabilities, feature) === "none") {
      throw unsupportedFeatureError(feature, capabilities.transport);
    }
  }
}
