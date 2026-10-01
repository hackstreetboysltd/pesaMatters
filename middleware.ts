const SESSION = "hs_session";
const DESK = "hs_desk";

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
    const login = path === "/desk/login" || path.startsWith("/desk/login/");
    if (!login && !hasCookie(cookies, DESK)) {
      const returnTo = encodeURIComponent(path);
      return Response.redirect(new URL(`/desk/login?returnTo=${returnTo}`, url.origin), 302);
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
