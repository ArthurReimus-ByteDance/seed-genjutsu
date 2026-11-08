import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const startScript = path.resolve("scripts/start.mjs");

test("production startup and the project worker share media after standalone changes cwd", async () => {
  for (const mode of ["relative", "default", "absolute"] as const) {
    const root = await realpath(
      await mkdtemp(path.join(tmpdir(), "seed-startup-")),
    );
    try {
      const expected = path.join(
        root,
        mode === "relative"
          ? "studio-media"
          : mode === "absolute"
            ? "absolute-media"
            : ".data",
      );
      const configuration =
        mode === "relative"
          ? "STUDIO_MEDIA=studio-media\nMEDIA_ROOT=./${STUDIO_MEDIA}\n"
          : mode === "absolute"
            ? `MEDIA_ROOT=${expected}\n`
            : "# Use the default media directory.\n";
      await Promise.all(
        [expected, "public", ".next/static", ".next/standalone"].map(
          (directory) =>
            mkdir(path.resolve(root, directory), { recursive: true }),
        ),
      );
      await writeFile(path.join(root, ".env.local"), configuration);
      // Represent media already persisted by a worker running from the project.
      await writeFile(path.join(expected, "worker-media"), "shared workspace");
      await writeFile(
        path.join(root, ".next/standalone/server.js"),
        `const fs = require("node:fs");
const path = require("node:path");
process.chdir(__dirname);
console.log(JSON.stringify({
  cwd: process.cwd(),
  mediaRoot: process.env.MEDIA_ROOT,
  workerMedia: fs.readFileSync(path.join(process.env.MEDIA_ROOT, "worker-media"), "utf8")
}));
`,
      );
      const childEnv: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_ENV: "production",
      };
      delete childEnv.MEDIA_ROOT;
      delete childEnv.STUDIO_MEDIA;
      delete childEnv.__NEXT_PROCESSED_ENV;
      const { stdout } = await run(process.execPath, [startScript], {
        cwd: root,
        env: childEnv,
        timeout: 10000,
      });
      const observed = JSON.parse(stdout.trim());
      assert.equal(observed.cwd, path.join(root, ".next/standalone"));
      assert.equal(observed.mediaRoot, expected, mode);
      assert.equal(observed.workerMedia, "shared workspace", mode);
      assert.equal(
        await readFile(path.join(root, ".env.local"), "utf8"),
        configuration,
        "Starting the app does not rewrite the user's environment file",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
