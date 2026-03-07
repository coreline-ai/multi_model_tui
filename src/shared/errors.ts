import type { CapabilityFeature, HumanInputRequest, UnifiedError } from "../types.js";

export class HttpStatusError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly bodyText?: string
  ) {
    super(message);
    this.name = "HttpStatusError";
  }
}

export class UnifiedProxyError extends Error {
  constructor(
    public readonly error: UnifiedError,
    public readonly statusCode = 500,
    public readonly humanInput?: HumanInputRequest
  ) {
    super(error.message);
    this.name = "UnifiedProxyError";
  }
}

export function unsupportedFeatureError(feature: CapabilityFeature, transport: string, message?: string): UnifiedProxyError {
  return new UnifiedProxyError(
    {
      code: "unsupported_feature",
      message: message ?? `${feature} is not supported by transport ${transport}`,
      transport,
      feature,
    },
    400
  );
}

export function humanInputRequiredError(
  request: HumanInputRequest,
  transport?: string,
  message?: string
): UnifiedProxyError {
  return new UnifiedProxyError(
    {
      code: "human_input_required",
      message: message ?? request.instructions,
      transport,
      feature: "hostedTools",
    },
    409,
    request
  );
}

export function toUnifiedError(error: unknown, transport?: string): UnifiedError {
  if (error instanceof UnifiedProxyError) {
    return error.error;
  }

  if (error instanceof HttpStatusError) {
    if (error.status === 401) {
      return { code: "auth_invalid", message: "auth invalid or expired", transport, raw: error.bodyText };
    }
    if (error.status === 429) {
      return { code: "rate_limited", message: "rate limited", transport, raw: error.bodyText };
    }
    if (error.status === 403) {
      return {
        code: "provider_error",
        message: error.bodyText ? `request denied: ${error.bodyText}` : "request denied",
        transport,
        raw: error.bodyText,
      };
    }

    return {
      code: "provider_error",
      message: error.bodyText ? `request failed: ${error.bodyText}` : `request failed: http ${error.status}`,
      transport,
      raw: error.bodyText,
    };
  }

  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return { code: "timeout", message: "timeout", transport };
    }

    const message = error.message || "unknown error";

    if (message.includes("missing ") && message.includes("auth")) {
      return { code: "auth_missing", message, transport };
    }

    if (message.includes("not found")) {
      return { code: "transport_unavailable", message, transport };
    }

    if (message.includes("invalid provider response")) {
      return { code: "invalid_response", message, transport };
    }

    if (message.includes("not supported")) {
      return { code: "unsupported_feature", message, transport };
    }

    return { code: "provider_error", message, transport };
  }

  return { code: "provider_error", message: "unknown error", transport };
}
