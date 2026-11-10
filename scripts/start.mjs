import { loadEnvironment } from "./environment.mjs";
import { access, cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

loadEnvironment({ defaultMode: "production" });
process.env.PORT ??= "3107";
process.env.HOSTNAME = "127.0.0.1";
const root = path.resolve(".next/standalone");
try {
  await access(path.join(root, "server.js"));
} catch {
  throw new Error("Run npm run build before starting Seed Genjutsu.");
}
await mkdir(path.join(root, ".next"), { recursive: true });
await cp("public", path.join(root, "public"), { recursive: true });
await cp(".next/static", path.join(root, ".next/static"), { recursive: true });
await import(pathToFileURL(path.join(root, "server.js")).href);
