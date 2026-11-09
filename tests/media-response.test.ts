import { after, test, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import type { ReadStream } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileResponse } from "../src/server/media-response";
import { parseByteRange } from "../src/lib/byte-range";

const root = await mkdtemp(path.join(tmpdir(), "seed-range-"));
const file = path.join(root, "fixture.bin");
const data = Buffer.alloc(1024 * 1024, 0x61);
await writeFile(file, data);
const handle = await open(file, "r");
const prototype = Object.getPrototypeOf(handle);
await handle.close();
after(() => rm(root, { recursive: true, force: true }));
const request = (range?: string, signal?: AbortSignal) =>
  new Request("http://localhost/media", {
    headers: range ? { range } : {},
    signal,
  });

test("range parsing handles suffixes and open ends and rejects invalid or unsafe ranges", () => {
  assert.deepEqual(parseByteRange("bytes=0-0", 10), { start: 0, end: 0 });
  assert.deepEqual(parseByteRange("bytes=8-", 10), { start: 8, end: 9 });
  assert.deepEqual(parseByteRange("bytes=-3", 10), { start: 7, end: 9 });
  assert.deepEqual(parseByteRange("bytes=1-99", 10), { start: 1, end: 9 });
  assert.deepEqual(parseByteRange("bytes=-99", 10), { start: 0, end: 9 });
  for (const invalid of [
    "bytes=-",
    "bytes=-0",
    "bytes=10-",
    "bytes=8-3",
    "bytes=1-2,4-5",
    "items=1-2",
    "bytes=9007199254740993-",
  ]) {
    assert.equal(parseByteRange(invalid, 10), null, invalid);
  }
  assert.equal(parseByteRange("bytes=0-0", 0), null);
});

test("a one-byte range actually reads one byte rather than the whole file", async () => {
  const streams: ReadStream[] = [];
  const original = prototype.createReadStream;
  const tracker = mock.method(
    prototype,
    "createReadStream",
    function (this: typeof handle, options: object) {
      const stream = original.call(this, options);
      streams.push(stream);
      return stream;
    },
  );
  try {
    const response = await fileResponse(request("bytes=20-20"), file, {
      "Content-Type": "video/mp4",
    });
    assert.equal(response.status, 206);
    assert.equal(
      response.headers.get("content-range"),
      `bytes 20-20/${data.length}`,
    );
    assert.equal(response.headers.get("content-length"), "1");
    assert.equal((await response.arrayBuffer()).byteLength, 1);
    assert.equal(streams.length, 1);
    assert.equal(streams[0].bytesRead, 1);
  } finally {
    tracker.mock.restore();
  }
});

test("full, suffix and concurrent range responses preserve exact bytes and 416 metadata", async () => {
  const full = await fileResponse(request(), file);
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), data);
  const ranges = await Promise.all(
    ["bytes=-3", "bytes=0-1", "bytes=999999-"].map(async (range) => {
      const response = await fileResponse(request(range), file);
      return Buffer.from(await response.arrayBuffer());
    }),
  );
  assert.deepEqual(
    ranges.map((buffer) => buffer.length),
    [3, 2, data.length - 999999],
  );
  for (const range of ["bytes=-", "bytes=9999999-", "bytes=4-1"]) {
    const response = await fileResponse(request(range), file);
    assert.equal(response.status, 416);
    assert.equal(
      response.headers.get("content-range"),
      "bytes */" + data.length,
    );
  }
  const empty = path.join(root, "empty");
  await writeFile(empty, "");
  assert.equal(
    (await fileResponse(request(), empty)).headers.get("content-length"),
    "0",
  );
  await assert.rejects(
    fileResponse(request(), path.join(root, "missing")),
    /unavailable/,
  );
});

test("response cancellation and request abort close the underlying file stream", async () => {
  const streams: ReadStream[] = [];
  const original = prototype.createReadStream;
  const tracker = mock.method(
    prototype,
    "createReadStream",
    function (this: typeof handle, options: object) {
      const stream = original.call(this, options);
      streams.push(stream);
      return stream;
    },
  );
  try {
    const response = await fileResponse(request(), file);
    const closed = new Promise<void>((resolve) =>
      streams[0].once("close", resolve),
    );
    await response.body!.cancel();
    await closed;
    assert.equal(streams[0].closed, true);
    const controller = new AbortController();
    const aborted = await fileResponse(
      request(undefined, controller.signal),
      file,
    );
    const reader = aborted.body!.getReader();
    controller.abort();
    await assert.rejects(reader.read());
    if (!streams[1].closed)
      await new Promise<void>((resolve) => streams[1].once("close", resolve));
    assert.equal(streams[1].closed, true);
  } finally {
    tracker.mock.restore();
  }
});
