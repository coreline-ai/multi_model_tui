export function getClaudeOAuthToken(token: string | undefined): string | null {
  if (!token) return null;
  const trimmed = token.trim();
  return trimmed ? trimmed : null;
}
