import nextEnv from "@next/env";
import path from "node:path";

export function loadEnvironment({
  root = process.cwd(),
  defaultMode = "development",
} = {}) {
  process.env.NODE_ENV ??= defaultMode;
  nextEnv.loadEnvConfig(root, process.env.NODE_ENV === "development");
  process.env.MEDIA_ROOT = path.resolve(
    root,
    process.env.MEDIA_ROOT || ".data",
  );
}
