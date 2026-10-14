const SESSION = "hs_session";
const ADMIN = "hs_admin";

/** Continue the request (Vercel Routing Middleware pass-through). */
function next(): Response {
  return new Response(null, {
    status: 200,
    headers: { "x-middleware-next": "1" },
  });
}

function hasCookie(header: string | null, name: string): boolean {
  if (header === null) return false;
  return new RegExp(`(?:^|;\\s*)${name}=`).test(header);
}

/** Map retired /desk bookmarks onto /admin. */
function deskToAdmin(path: string): string {
  if (path === "/desk" || path === "/desk/") return "/admin";
  if (path === "/desk/login" || path.startsWith("/desk/login/")) return "/admin/login";
  if (path === "/desk/queue" || path.startsWith("/desk/queue/")) return "/admin/loans";
  if (path === "/desk/you" || path.startsWith("/desk/you/")) return "/admin";
  const work = path.match(/^\/desk\/work\/([a-f0-9]{32})\/?$/);
  if (work !== null) return `/admin/loans/${work[1]}`;
  if (path === "/desk/work" || path.startsWith("/desk/work/")) return "/admin/loans";
  return "/admin";
}

export default function middleware(request: Request): Response {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") {
    return next();
  }
  const accept = request.headers.get("accept") ?? "";
  if (!accept.includes("text/html")) {
    return next();
  }
  const path = url.pathname;
  const cookies = request.headers.get("cookie");

  if (path === "/desk" || path.startsWith("/desk/")) {
    return Response.redirect(new URL(deskToAdmin(path), url.origin), 302);
  }

  if (path === "/admin" || path.startsWith("/admin/")) {
    const login = path === "/admin/login" || path.startsWith("/admin/login/");
    if (!login && !hasCookie(cookies, ADMIN)) {
      const returnTo = encodeURIComponent(path);
      return Response.redirect(new URL(`/admin/login?returnTo=${returnTo}`, url.origin), 302);
    }
    return next();
  }

  if (
    path === "/login" ||
    path.startsWith("/login/") ||
    path.startsWith("/api/") ||
    path.startsWith("/assets/") ||
    path === "/theme-init.js" ||
    path === "/favicon.ico" ||
    path.includes(".")
  ) {
    return next();
  }

  if (hasCookie(cookies, SESSION)) {
    return next();
  }

  const returnTo = encodeURIComponent(path === "/" ? "/" : path);
  const location = path === "/" ? "/login" : `/login?returnTo=${returnTo}`;
  return Response.redirect(new URL(location, url.origin), 302);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|assets/).*)"],
};
