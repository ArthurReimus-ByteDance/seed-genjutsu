import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const root = await mkdtemp(path.join(tmpdir(), "seed-credentials-"));
const project = fileURLToPath(new URL("..", import.meta.url));
after(() => rm(root, { recursive: true, force: true }));

async function inspectCredentials(configuration: Partial<NodeJS.ProcessEnv>) {
  const { stdout } = await run(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `
        import { tos } from "./src/server/storage.ts";
        import { signedHeaders } from "./src/server/providers.ts";
        import { GET } from "./src/app/api/capabilities/route.ts";
        let storage;
        let portrait;
        try {
          const url = new URL(tos().getPreSignedUrl({
            bucket: process.env.TOS_BUCKET,
            key: "fixture",
            method: "GET",
          }));
          storage = {
            credential: url.searchParams.get("X-Tos-Credential"),
            token: url.searchParams.get("X-Tos-Security-Token"),
          };
        } catch (error) {
          storage = { code: error.code, status: error.status };
        }
        try {
          const headers = signedHeaders("GetAsset", "{}");
          portrait = {
            authorization: headers.Authorization,
            token: headers["x-security-token"] ?? null,
          };
        } catch (error) {
          portrait = { code: error.code, status: error.status };
        }
        const response = await GET(new Request("http://localhost:3107/api/capabilities"));
        console.log(JSON.stringify({
          storage,
          portrait,
          capabilities: await response.json(),
        }));
      `,
    ],
    {
      cwd: project,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        APP_URL: "http://localhost:3107",
        MEDIA_ROOT: root,
        STORAGE_MODE: "tos",
        BYTEPLUS_ACCESS_KEY: "fixture-shared-access",
        BYTEPLUS_SECRET_KEY: "fixture-shared-secret",
        TOS_BUCKET: "fixture-bucket",
        ...configuration,
      },
      timeout: 15000,
    },
  );
  return JSON.parse(stdout.trim());
}

test("TOS and Ark sign with one BytePlus pair and the same optional STS token", async () => {
  for (const token of ["", "fixture-session-token"]) {
    const result = await inspectCredentials({
      BYTEPLUS_SESSION_TOKEN: token,
      TOS_ACCESS_KEY: "fixture-obsolete-access",
      TOS_SECRET_KEY: "fixture-obsolete-secret",
      TOS_SESSION_TOKEN: "fixture-obsolete-token",
    });
    assert.match(result.storage.credential, /^fixture-shared-access\//);
    assert.match(
      result.portrait.authorization,
      /Credential=fixture-shared-access\//,
    );
    assert.equal(result.storage.token, token || null);
    assert.equal(result.portrait.token, token || null);
    assert.equal(result.capabilities.storage, true);
    assert.equal(result.capabilities.portraits, true);
    assert.doesNotMatch(
      JSON.stringify(result.capabilities),
      /fixture-|BYTEPLUS_SECRET_KEY|BYTEPLUS_SESSION_TOKEN/,
    );
  }
});

test("missing or incomplete shared credentials disable both integrations without using old TOS keys", async () => {
  for (const credentials of [
    { BYTEPLUS_ACCESS_KEY: "", BYTEPLUS_SECRET_KEY: "" },
    { BYTEPLUS_ACCESS_KEY: "" },
    { BYTEPLUS_SECRET_KEY: "" },
  ]) {
    const result = await inspectCredentials({
      ...credentials,
      TOS_ACCESS_KEY: "fixture-obsolete-access",
      TOS_SECRET_KEY: "fixture-obsolete-secret",
      TOS_SESSION_TOKEN: "fixture-obsolete-token",
    });
    assert.deepEqual(result.storage, { code: "STORAGE_SETUP", status: 503 });
    assert.deepEqual(result.portrait, { code: "PORTRAIT_SETUP", status: 503 });
    assert.equal(result.capabilities.storage, false);
    assert.equal(result.capabilities.portraits, false);
  }
});

test("TOS still requires its own bucket and storage mode", async () => {
  const missingBucket = await inspectCredentials({ TOS_BUCKET: "" });
  assert.deepEqual(missingBucket.storage, {
    code: "STORAGE_SETUP",
    status: 503,
  });
  assert.equal(missingBucket.capabilities.storage, false);
  assert.equal(missingBucket.capabilities.portraits, true);

  const local = await inspectCredentials({ STORAGE_MODE: "local" });
  assert.equal(local.capabilities.storage, false);
  assert.equal(local.capabilities.portraits, true);
});
