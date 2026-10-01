/**
 * Keep post-login redirects on this origin.
 * Rejects protocol-relative and absolute URLs (open-redirect surface).
 */
export function safeReturnTo(raw: string | null | undefined, fallback = "/"): string {
  if (raw === null || raw === undefined) return fallback;
  const value = raw.trim();
  if (value.length === 0 || value.length > 512) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.includes("://") || value.includes("\\")) return fallback;
  if (value === "/login" || value.startsWith("/login?") || value.startsWith("/login/")) {
    return fallback;
  }
  return value;
}
