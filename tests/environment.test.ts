import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
  stat,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const project = process.cwd();

test("setup preserves existing .env or .env.local instead of masking their configuration", async () => {
  for (const files of [[], [".env"], [".env.local"], [".env", ".env.local"]]) {
    const root = await mkdtemp(path.join(tmpdir(), "seed-setup-"));
    try {
      await writeFile(
        path.join(root, ".env.example"),
        "BYTEPLUS_API_KEY=\nMEDIA_ROOT=.data\n",
      );
      for (const file of files)
        await writeFile(
          path.join(root, file),
          "BYTEPLUS_API_KEY=fixture-existing\n",
        );
      await run(process.execPath, [path.join(project, "scripts/setup.mjs")], {
        cwd: root,
        env: { PATH: process.env.PATH, NODE_ENV: "test" },
      });
      for (const file of files) {
        assert.equal(
          await readFile(path.join(root, file), "utf8"),
          "BYTEPLUS_API_KEY=fixture-existing\n",
        );
      }
      if (files.length === 0) {
        assert.equal(
          (await stat(path.join(root, ".env.local"))).mode & 0o777,
          0o600,
        );
        assert.match(
          await readFile(path.join(root, ".env.local"), "utf8"),
          /MEDIA_ROOT=.*\/\.data/,
        );
      } else if (!files.includes(".env.local")) {
        await assert.rejects(stat(path.join(root, ".env.local")), {
          code: "ENOENT",
        });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("environment bootstrap chooses explicit modes consistently and retains shell overrides", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "seed-env-mode-"));
  try {
    await writeFile(
      path.join(root, ".env.development"),
      "MEDIA_ROOT=development-media\nBYTEPLUS_API_KEY=fixture-development\n",
    );
    await writeFile(
      path.join(root, ".env.production"),
      "MEDIA_ROOT=production-media\nBYTEPLUS_API_KEY=fixture-production\n",
    );
    for (const mode of ["development", "production"] as const) {
      for (const override of [false, true]) {
        const { stdout } = await run(
          process.execPath,
          [
            "--input-type=module",
            "--eval",
            `
          import { loadEnvironment } from ${JSON.stringify(new URL("../scripts/environment.mjs", import.meta.url).href)};
          loadEnvironment({ root: process.argv[1] });
          console.log(JSON.stringify({root:process.env.MEDIA_ROOT,key:process.env.BYTEPLUS_API_KEY}));
        `,
            root,
          ],
          {
            cwd: root,
            env: {
              PATH: process.env.PATH,
              NODE_ENV: mode,
              ...(override ? { BYTEPLUS_API_KEY: "fixture-shell" } : {}),
            },
          },
        );
        const observed = JSON.parse(stdout.trim());
        assert.equal(observed.root, path.join(root, `${mode}-media`));
        assert.equal(
          observed.key,
          override ? "fixture-shell" : `fixture-${mode}`,
        );
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("setup does not swallow filesystem failures", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "seed-setup-error-"));
  try {
    await mkdir(path.join(root, ".env.example"));
    await assert.rejects(
      run(process.execPath, [path.join(project, "scripts/setup.mjs")], {
        cwd: root,
        env: { PATH: process.env.PATH, NODE_ENV: "test" },
      }),
    );
    await assert.rejects(stat(path.join(root, ".env.local")), {
      code: "ENOENT",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
