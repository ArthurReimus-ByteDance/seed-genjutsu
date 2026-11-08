import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import {
  segmentVideo,
  parseSavedMasks,
  samVideoDataUrl,
} from "../src/server/meta-sam";
import { renderMaskedVideo } from "../src/server/sam-render";
import { ProviderError } from "../src/server/providers";
import { maskLine, segmentationEvents } from "../scripts/fixtures/meta-sam";

const run = promisify(execFile);

test("SAM inline preparation drops the soundtrack and preserves the prepared video track", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "recast-meta-inline-"));
  const source = path.join(dir, "source.mp4");
  const inline = path.join(dir, "inline.mp4");
  const oversized = path.join(dir, "oversized.mp4");
  try {
    await run("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=320x180:r=24:d=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      source,
    ]);
    const sourceBytes = await readFile(source);
    const dataUrl = await samVideoDataUrl(source);
    const prefix = "data:video/mp4;base64,";
    assert.ok(dataUrl.startsWith(prefix));
    await writeFile(inline, Buffer.from(dataUrl.slice(prefix.length), "base64"));
    async function streams(file: string) {
      const { stdout } = await run("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type,width,height,avg_frame_rate,duration,nb_frames",
        "-of",
        "csv=p=0",
        file,
      ]);
      return stdout.trim().split("\n");
    }
    async function videoHash(file: string) {
      const { stdout } = await run("ffmpeg", [
        "-v",
        "error",
        "-i",
        file,
        "-map",
        "0:v:0",
        "-c:v",
        "copy",
        "-f",
        "hash",
        "pipe:1",
      ]);
      return stdout;
    }
    const sourceStreams = await streams(source);
    assert.match(sourceStreams[1], /^audio,/);
    assert.deepEqual(await streams(inline), [sourceStreams[0]]);
    assert.equal(await videoHash(inline), await videoHash(source));
    assert.deepEqual(await readFile(source), sourceBytes);

    // Grow a valid MP4 past the inline cap by looping the small video track.
    await run(
      "ffmpeg",
      [
        "-v",
        "error",
        "-stream_loop",
        "-1",
        "-i",
        inline,
        "-c:v",
        "copy",
        "-fs",
        String(33 * 1024 * 1024),
        oversized,
      ],
      { timeout: 30_000 },
    );
    await assert.rejects(
      samVideoDataUrl(oversized),
      (error: unknown) =>
        (error as { code?: string }).code === "META_VIDEO_LIMIT",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Meta contract sends inline video in one authenticated POST and parses split SSE frames", async () => {
  let calls = 0;
  const output = maskLine(2) + maskLine(0);
  const video = "data:video/mp4;base64,cHJlcGFyZWQtdmlkZW8tZml4dHVyZQ==";
  const server = createServer(async (request, response) => {
    calls++;
    assert.equal(request.method, "POST");
    assert.equal(request.headers.authorization, "Bearer test-meta-key");
    let body = "";
    for await (const chunk of request) body += chunk;
    assert.deepEqual(JSON.parse(body), {
      model: "sam-3.1",
      stream: true,
      metadata: { mask_encoding: "one_bit" },
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "person in a red jacket" },
            { type: "input_video", video_url: video },
          ],
        },
      ],
    });
    response.writeHead(200, { "content-type": "text/event-stream" });
    const wire = segmentationEvents(output);
    for (let i = 0; i < wire.length; i += 23) {
      response.write(wire.slice(i, i + 23));
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    response.end();
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    let savedId = "";
    const { result, responseId } = await segmentVideo(
      video,
      "person in a red jacket",
      undefined,
      {
        apiKey: "test-meta-key",
        request: (url, options) => {
          assert.equal(url, "https://api.meta.ai/v1/responses");
          return fetch(
            "http://127.0.0.1:" + (server.address() as { port: number }).port,
            options,
          );
        },
        onResponseId: async (id) => {
          savedId = id;
        },
      },
    );
    assert.equal(calls, 1);
    assert.equal(responseId, "resp_synthetic");
    assert.equal(savedId, responseId);
    assert.equal(result.outcome.status, "completed");
    assert.equal(result.rawOutput, output);
    assert.equal(result.diagnostics.length, 0);
    assert.deepEqual(
      result.records
        .filter((record) => record.kind === "mask")
        .map((mask) => mask.frame?.frameIndex),
      [2, 0],
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("Meta failures are never silently retried and partial streams require attention", async () => {
  for (const status of [400, 401, 402, 429, 503, 200]) {
    let calls = 0;
    await assert.rejects(
      segmentVideo("https://example.com/clip.mp4", "person", undefined, {
        apiKey: "test-meta-key",
        request: async () => {
          calls++;
          return status === 200
            ? new Response(segmentationEvents(maskLine(), false), {
                headers: { "content-type": "text/event-stream" },
              })
            : new Response(
                JSON.stringify({
                  error: {
                    code:
                      status === 400 ? "media_url_not_fetchable" : "rejected",
                    message: "private account details and test-meta-key",
                  },
                }),
                { status },
              );
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        assert.equal(error.ambiguous, status >= 500 || status === 200);
        assert.equal(error.retryable, status === 429);
        assert.equal(error.httpStatus, status === 200 ? undefined : status);
        assert.ok(!error.message.includes("test-meta-key"));
        assert.ok(!error.message.includes("private account"));
        if (status === 402) assert.match(error.message, /billing/);
        if (status === 400) assert.match(error.message, /inline video/);
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});

test("mask rendering keeps coordinates, missing frames, revisions, duration and background", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "recast-mask-test-"));
  const source = path.join(dir, "source.mp4");
  try {
    await run("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=red:s=96x64:r=24:d=4",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      source,
    ]);
    const result = parseSavedMasks(
      maskLine(2) + maskLine(0) + maskLine(2, 96, 64, 7, 50),
    );
    const rendered = await renderMaskedVideo(source, result);
    try {
      const { stdout } = await run(
        "ffmpeg",
        [
          "-v",
          "error",
          "-i",
          rendered.file,
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "pipe:1",
        ],
        { encoding: "buffer", maxBuffer: 4 * 1024 * 1024 },
      );
      assert.equal(stdout.length / (96 * 64 * 3), 96);
      assert.ok(Math.abs(rendered.meta.duration - 4) < 0.05);
      assert.equal(rendered.meta.hasAudio, false);
      const pixel = (frame: number, x: number, y: number) => [
        ...stdout.subarray(
          ((frame * 64 + y) * 96 + x) * 3,
          ((frame * 64 + y) * 96 + x) * 3 + 3,
        ),
      ];
      const grey = (p: number[]) =>
        p.every((value) => Math.abs(value - 128) < 12);
      const red = (p: number[]) => p[0] > 220 && p[1] < 25 && p[2] < 25;
      assert.ok(
        grey(pixel(0, 30, 25)),
        "Mask is placed at its source-pixel box",
      );
      assert.ok(red(pixel(0, 5, 5)), "Background remains visible");
      assert.ok(
        red(pixel(1, 30, 25)),
        "Omitted frames do not inherit earlier masks",
      );
      assert.ok(red(pixel(2, 30, 25)), "An old revision is replaced");
      assert.ok(grey(pixel(2, 60, 25)), "Latest frame revision wins");
      assert.ok(red(pixel(95, 30, 25)), "No phantom mask after tracking ends");
    } finally {
      await rm(rendered.dir, { recursive: true, force: true });
    }
    for (const output of [
      "",
      maskLine(0) + maskLine(1, 96, 64, 11),
      maskLine(100),
    ])
      await assert.rejects(
        renderMaskedVideo(source, parseSavedMasks(output)),
        ProviderError,
      );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
