import type { ProviderStatus } from "../types.js";

export function summarizeStatuses(statuses: ProviderStatus[]): string {
  return statuses.map((status) => `${status.provider}=${status.availability}`).join(" ");
}
