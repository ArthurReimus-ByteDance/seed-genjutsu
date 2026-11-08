import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { JsonFileStore } from "../src/server/json-file";

test("separate processes update one local workspace without losing writes", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "recast-lock-test-"));
  const file = path.join(dir, "state.json");
  try {
    const source = new URL("../src/server/json-file.ts", import.meta.url).href;
    const code = `import { JsonFileStore } from ${JSON.stringify(source)};
      import { z } from 'zod';
      const store = new JsonFileStore(process.argv[1], z.object({ writes: z.array(z.string()) }), () => ({ writes: [] }));
      for(let i=0;i<8;i++) await store.update(state => { state.writes.push(process.argv[2]+i); });`;
    await Promise.all(
      ["web", "worker", "second-worker"].map((id) =>
        promisify(execFile)(process.execPath, [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          code,
          file,
          id,
        ]),
      ),
    );
    const reopened = new JsonFileStore(
      file,
      z.object({ writes: z.array(z.string()) }),
      () => ({ writes: [] }),
    );
    const writes = await reopened.read((state) => state.writes);
    assert.equal(writes.length, 24);
    assert.equal(new Set(writes).size, 24);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("failed transactions and corrupt files preserve the previous document", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "recast-integrity-test-"));
  const file = path.join(dir, "state.json");
  const store = new JsonFileStore(
    file,
    z.object({ marker: z.string() }),
    () => ({ marker: "saved" }),
  );
  try {
    await store.read((state) => state.marker);
    await assert.rejects(
      store.update((state) => {
        state.marker = "lost";
        throw new Error("interrupted");
      }),
    );
    assert.equal(await store.read((state) => state.marker), "saved");
    await writeFile(file, "broken document");
    await assert.rejects(
      store.update((state) => {
        state.marker = "reset";
      }),
      /workspace file is invalid/,
    );
    assert.equal(await readFile(file, "utf8"), "broken document");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
