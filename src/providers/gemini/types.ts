export type ServiceUsageState = "STATE_UNSPECIFIED" | "DISABLED" | "ENABLED";

export interface ProjectDiscoveryResponse {
  cloudaicompanionProject?: string | { id?: string };
  allowedTiers?: Array<{ id?: string; isDefault?: boolean }>;
  currentTier?: {
    id?: string;
    userDefinedCloudaicompanionProject?: boolean;
  };
  projectValidationError?: {
    message?: string;
  };
}

export interface CloudProjectsResponse {
  projects?: Array<{ projectId?: string; lifecycleState?: string; name?: string }>;
}

export interface OnboardUserResponse {
  done?: boolean;
  response?: { cloudaicompanionProject?: { id?: string } };
}

export interface GeminiPart {
  text?: string;
  thought?: boolean;
  functionCall?: {
    name?: string;
    args?: unknown;
  };
  inlineData?: {
    mimeType?: string;
    data?: string;
  };
  fileData?: {
    mimeType?: string;
    fileUri?: string;
  };
}

export interface GeminiCandidate {
  content?: {
    parts?: GeminiPart[];
  };
  finishReason?: string;
}

export interface GeminiStreamResponse {
  response?: {
    candidates?: GeminiCandidate[];
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
      thoughtsTokenCount?: number;
      cachedContentTokenCount?: number;
    };
  };
}

export interface ServiceUsageResponse {
  state?: ServiceUsageState;
}

export interface GeminiCliResponse {
  response?: string;
}
