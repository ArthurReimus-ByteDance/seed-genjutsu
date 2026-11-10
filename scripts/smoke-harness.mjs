import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { access, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("..", import.meta.url));

export function smokeEnvironment(root, port, instance) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    NODE_ENV: "production",
    PORT: String(port),
    APP_URL: `http://127.0.0.1:${port}`,
    MEDIA_ROOT: path.join(root, "media"),
    DEMO_ENABLED: "true",
    STORAGE_MODE: "local",
    BYTEPLUS_API_KEY: "",
    BYTEPLUS_ACCESS_KEY: "",
    BYTEPLUS_SECRET_KEY: "",
    BYTEPLUS_SESSION_TOKEN: "",
    META_API_KEY: "",
    SEEDREAM_MODEL: "",
    TOS_BUCKET: "",
    WORKER_POLL_MS: "500",
    NEXT_TELEMETRY_DISABLED: "1",
    TSX_TSCONFIG_PATH: path.join(project, "tsconfig.json"),
    STUDIO_SMOKE_INSTANCE: instance,
  };
}

export async function runSmoke(mode = "all") {
  if (!["all", "live", "demo"].includes(mode))
    throw new Error(
      "Smoke accepts all, live or demo, not an external server URL.",
    );
  await access(path.join(project, ".next/standalone/server.js"));
  const root = await mkdtemp(path.join(tmpdir(), "seed-smoke-"));
  const processes = [];
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  function launch(args, cwd, env) {
    const child = spawn(process.execPath, args, {
      cwd,
      env,
      signal: controller.signal,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    const done = new Promise((resolve) => {
      child.once("error", (error) => {
        output += error.message;
      });
      child.once("close", (code) => resolve({ code, output }));
    });
    processes.push({ child, done });
    return { child, done };
  }
  try {
    await symlink(
      path.join(project, "public"),
      path.join(root, "public"),
      "dir",
    );
    const probe = createServer();
    await new Promise((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", resolve);
    });
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const env = smokeEnvironment(root, port, randomUUID());
    const web = launch([path.join(project, "scripts/start.mjs")], project, env);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Owned web server did not start.")),
        20000,
      );
      web.child.stdout.on("data", (chunk) => {
        if (chunk.toString().includes("Ready")) {
          clearTimeout(timer);
          resolve();
        }
      });
      web.done.then(({ output }) => {
        clearTimeout(timer);
        reject(new Error("Owned web server exited: " + output));
      });
    });
    const loader = path.join(project, "node_modules/tsx/dist/loader.mjs");
    launch(
      ["--import", loader, path.join(project, "scripts/worker.ts")],
      root,
      env,
    );
    for (const script of mode === "demo"
      ? ["demo-smoke.ts"]
      : mode === "live"
        ? ["smoke.ts"]
        : ["smoke.ts", "demo-smoke.ts"]) {
      const check = launch(
        ["--import", loader, path.join(project, "scripts", script)],
        root,
        env,
      );
      let timer;
      const result = await Promise.race([
        check.done,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(script + " timed out.")),
            150000,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (result.code !== 0) throw new Error(result.output);
      process.stdout.write(result.output);
    }
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    await Promise.all(
      processes.map(async ({ child, done }) => {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGTERM");
        const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
        await done;
        clearTimeout(timer);
      }),
    );
    await rm(root, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runSmoke(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
