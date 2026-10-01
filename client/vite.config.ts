import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const SESSION_COOKIE = "hs_session";

/**
 * Cookie-presence gate for document navigations (same idea as internal-app middleware).
 * APIs stay public at this layer; Express still validates the session on /api/*.
 */
function sessionGate(): Plugin {
  return {
    name: "pesamatters-session-gate",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          next();
          return;
        }
        const accept = req.headers.accept ?? "";
        if (!accept.includes("text/html")) {
          next();
          return;
        }
        const rawUrl = req.url ?? "/";
        const path = rawUrl.split("?")[0] ?? "/";
        if (path === "/desk" || path.startsWith("/desk/")) {
          const asset = path.includes(".");
          if (!asset) {
            const deskCookie = /(?:^|;\s*)hs_desk=/.test(req.headers.cookie ?? "");
            const login = path === "/desk/login" || path.startsWith("/desk/login/");
            if (!login && !deskCookie) {
              const returnTo = encodeURIComponent(path);
              res.statusCode = 302;
              res.setHeader("Location", `/desk/login?returnTo=${returnTo}`);
              res.end();
              return;
            }
            req.url = "/desk.html";
          }
          next();
          return;
        }
        if (
          path === "/login" ||
          path.startsWith("/login/") ||
          path.startsWith("/api/") ||
          path.startsWith("/@") ||
          path.startsWith("/src/") ||
          path.startsWith("/node_modules/") ||
          path.startsWith("/assets/") ||
          path === "/theme-init.js" ||
          path === "/favicon.ico"
        ) {
          next();
          return;
        }
        const cookie = req.headers.cookie ?? "";
        if (new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=`).test(cookie)) {
          next();
          return;
        }
        const returnTo = encodeURIComponent(path === "/" ? "/" : path);
        res.statusCode = 302;
        res.setHeader("Location", path === "/" ? "/login" : `/login?returnTo=${returnTo}`);
        res.end();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), sessionGate()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        desk: resolve(__dirname, "desk.html"),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
