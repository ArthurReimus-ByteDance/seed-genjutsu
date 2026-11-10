import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvironment } from "./environment.mjs";

loadEnvironment({ defaultMode: "production" });
const state = JSON.parse(
  await readFile(path.join(process.env.MEDIA_ROOT, "workspace.json"), "utf8"),
);
const times = Object.values(state.workerHeartbeats ?? {});
if (
  !times.some((time) => typeof time === "number" && time > Date.now() - 30000)
)
  throw new Error("No fresh worker heartbeat.");
