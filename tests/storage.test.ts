import { after, mock, test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const root = await mkdtemp(path.join(tmpdir(), "recast-cache-test-"));
process.env.MEDIA_ROOT = root;
process.env.STORAGE_MODE = "tos";
process.env.TOS_ACCESS_KEY = "fixture-access";
process.env.TOS_SECRET_KEY = "fixture-secret";
process.env.TOS_BUCKET = "fixture-bucket";
const { localPath, tos } = await import("../src/server/storage");
const client = tos();
after(() => rm(root, { recursive: true, force: true }));
const complete = Buffer.from("complete immutable object");
const interrupted = Buffer.from("partial");

async function fixture() {
  const id = randomUUID();
  const row = {
    id,
    kind: "video" as const,
    name: "video.mp4",
    mime: "video/mp4",
    bytes: complete.length,
    width: 320,
    height: 180,
    duration: 4,
    storage_key: "fixture/" + id,
    poster_id: null,
  };
  const file = path.join(root, id);
  await mkdir(root, { recursive: true });
  await writeFile(file, interrupted, { mode: 0o600 });
  return { row, file };
}

test("TOS recovery repairs an interrupted cache and reuses the complete copy while offline", async () => {
  const { row, file } = await fixture();
  const remote = mock.method(client, "getObjectV2", async () => ({
    data: { content: complete },
  }));
  try {
    assert.equal(await localPath(row), file);
    assert.deepEqual(await readFile(file), complete);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal(remote.mock.callCount(), 1);
    remote.mock.mockImplementation(async () => {
      throw new Error("offline");
    });
    assert.equal(await localPath(row), file);
    assert.equal(remote.mock.callCount(), 1);
    assert.ok((await readdir(root)).every((name) => !name.endsWith(".tmp")));
  } finally {
    remote.mock.restore();
  }
});

test("failed or incomplete TOS recovery preserves the previous cache without publishing partial bytes", async () => {
  for (const response of [Buffer.from("short"), new Error("offline")]) {
    const { row, file } = await fixture();
    const remote = mock.method(client, "getObjectV2", async () => {
      if (response instanceof Error) throw response;
      return { data: { content: response } };
    });
    try {
      await assert.rejects(localPath(row), (error: unknown) =>
        response instanceof Error
          ? error === response
          : (error as { code?: string; status?: number }).code ===
              "FILE_RECOVERY" && (error as { status?: number }).status === 502,
      );
      assert.deepEqual(await readFile(file), interrupted);
      assert.ok((await readdir(root)).every((name) => !name.endsWith(".tmp")));
    } finally {
      remote.mock.restore();
    }
  }
});
