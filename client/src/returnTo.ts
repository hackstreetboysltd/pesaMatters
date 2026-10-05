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
  if (value === "/admin/login" || value.startsWith("/admin/login?") || value.startsWith("/admin/login/")) {
    return fallback;
  }
  return value;
}

/** Admin SPA post-login path (basename `/admin`). */
export function safeAdminReturnTo(raw: string | null | undefined, fallback = "/"): string {
  const next = safeReturnTo(raw, fallback);
  if (next === "/admin" || next.startsWith("/admin/")) {
    const stripped = next === "/admin" ? "/" : next.slice("/admin".length);
    return stripped.startsWith("/") ? stripped : `/${stripped}`;
  }
  if (next.startsWith("/") && !next.startsWith("//")) return next;
  return fallback;
}
