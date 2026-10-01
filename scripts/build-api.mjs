import * as esbuild from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("api", { recursive: true });

await esbuild.build({
  entryPoints: ["server/src/vercel.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "api/index.js",
  external: ["pg", "pg-native", "@upstash/redis", "@upstash/ratelimit"],
  // CJS bundle: synthesize import.meta.url from __filename for schema/data paths.
  banner: {
    js: 'const import_meta = { url: require("url").pathToFileURL(__filename).href };',
  },
  define: {
    "import.meta.url": "import_meta.url",
  },
  // Vercel expects module.exports = expressApp (not exports.default).
  footer: {
    js: "module.exports = module.exports.default;",
  },
  logLevel: "info",
});
