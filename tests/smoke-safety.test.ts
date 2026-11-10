import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertSmokeTarget } from "../scripts/smoke-safety.mjs";
import { runSmoke, smokeEnvironment } from "../scripts/smoke-harness.mjs";

const run = promisify(execFile);
const root = await mkdtemp(path.join(tmpdir(), "seed-smoke-safety-"));
process.env.MEDIA_ROOT = root;
process.env.APP_URL = "http://localhost:3107";
const { workspace } = await import("../src/server/workspace");
const { GET } = await import("../src/app/api/health/route");
after(() => rm(root, { recursive: true, force: true }));

test("smoke ownership and all provider flags are checked before mutating a target", async () => {
  const disabled = Object.fromEntries(
    ["video", "image", "storage", "portraits", "sam", "promptEnhancement"].map(
      (key) => [key, false],
    ),
  );
  assert.doesNotThrow(() =>
    assertSmokeTarget(
      "fixture-instance",
      { smokeInstance: "fixture-instance" },
      disabled,
    ),
  );
  for (const instance of [undefined, "", "different"]) {
    assert.throws(() =>
      assertSmokeTarget(
        instance,
        { smokeInstance: "fixture-instance" },
        disabled,
      ),
    );
  }
  for (const flag of Object.keys(disabled)) {
    assert.throws(() =>
      assertSmokeTarget(
        "fixture-instance",
        { smokeInstance: "fixture-instance" },
        { ...disabled, [flag]: true },
      ),
    );
  }
  assert.throws(() =>
    assertSmokeTarget(
      "fixture-instance",
      { smokeInstance: "fixture-instance" },
      { ...disabled, sam: undefined },
    ),
  );
  await assert.rejects(
    runSmoke("http://localhost:3107"),
    /not an external server URL/,
  );
});

test("smoke environment cannot inherit keys, workspace paths, or loader overrides", () => {
  const env = smokeEnvironment(root, 34567, "fixture-instance");
  for (const key of [
    "BYTEPLUS_API_KEY",
    "BYTEPLUS_ACCESS_KEY",
    "BYTEPLUS_SECRET_KEY",
    "BYTEPLUS_SESSION_TOKEN",
    "META_API_KEY",
    "SEEDREAM_MODEL",
    "TOS_BUCKET",
  ]) {
    assert.equal(env[key as keyof typeof env], "");
  }
  assert.equal(env.MEDIA_ROOT, path.join(root, "media"));
  assert.equal(env.APP_URL, "http://127.0.0.1:34567");
  assert.equal("NODE_OPTIONS" in env, false);
});

test("direct smoke execution without ownership refuses before opening a workspace", async () => {
  const mediaRoot = path.join(root, "must-not-create");
  await assert.rejects(
    run(
      process.execPath,
      [
        "--import",
        path.resolve("node_modules/tsx/dist/loader.mjs"),
        path.resolve("scripts/smoke.ts"),
      ],
      {
        cwd: root,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "test",
          MEDIA_ROOT: mediaRoot,
        },
      },
    ),
    /Use npm run smoke/,
  );
  await assert.rejects(stat(mediaRoot), { code: "ENOENT" });
});

test("worker readiness expires independently of web liveness and recovers", async () => {
  const live = () => GET(new Request("http://localhost:3107/api/health"));
  const ready = () =>
    GET(new Request("http://localhost:3107/api/health?worker=1"));
  assert.equal((await live()).status, 200);
  assert.equal((await ready()).status, 503);
  await workspace.update((state) => {
    state.workerHeartbeats.fixture = Date.now();
  });
  assert.equal((await ready()).status, 200);
  await workspace.update((state) => {
    state.workerHeartbeats.fixture = Date.now() - 31000;
  });
  assert.equal((await ready()).status, 503);
  assert.equal((await live()).status, 200);
  await workspace.update((state) => {
    state.workerHeartbeats.fixture = Date.now();
  });
  assert.equal((await ready()).status, 200);
});
