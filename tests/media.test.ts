import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { restoreAudio, probe, trimVideo } from "../src/server/media";

const run = promisify(execFile);

test("original-audio finishing keeps the generated video and restores the source soundtrack or silence", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "recast-audio-test-"));
  try {
    const generated = path.join(dir, "generated.mp4");
    const silentGenerated = path.join(dir, "generated-silent.mp4");
    const voiced = path.join(dir, "source-audio.mp4");
    const shortVoiced = path.join(dir, "source-short-audio.mp4");
    const silent = path.join(dir, "source-silent.mp4");
    for (const [file, color, frequency, audioDuration] of [
      [generated, "blue", 880, 1],
      [silentGenerated, "blue", null, 0],
      [voiced, "red", 440, 1],
      [shortVoiced, "red", 440, 0.2],
      [silent, "red", null, 0],
    ] as const) {
      await run("ffmpeg", [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=${color}:s=96x64:r=24:d=1`,
        ...(frequency
          ? [
              "-f",
              "lavfi",
              "-i",
              `sine=frequency=${frequency}:sample_rate=16000:duration=${audioDuration}`,
            ]
          : []),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        file,
      ]);
    }
    async function firstFrame(file: string) {
      return (
        await run(
          "ffmpeg",
          [
            "-v",
            "error",
            "-i",
            file,
            "-frames:v",
            "1",
            "-pix_fmt",
            "rgb24",
            "-f",
            "rawvideo",
            "pipe:1",
          ],
          { encoding: "buffer" },
        )
      ).stdout;
    }
    const expectedFrame = await firstFrame(generated);
    for (const [output, source, hasAudio] of [
      [generated, voiced, true],
      [silentGenerated, shortVoiced, true],
      [generated, silent, false],
    ] as const) {
      const restored = path.join(dir, hasAudio ? "restored.mp4" : "muted.mp4");
      await writeFile(restored, await restoreAudio(output, source));
      const meta = await probe(restored);
      assert.equal(meta.hasAudio, hasAudio);
      assert.ok(Math.abs(meta.duration - 1) < 0.15);
      const frames = JSON.parse(
        (
          await run("ffprobe", [
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=nb_frames",
            "-of",
            "json",
            restored,
          ])
        ).stdout,
      );
      assert.equal(Number(frames.streams[0].nb_frames), 24);
      assert.deepEqual(await firstFrame(restored), expectedFrame);
      if (hasAudio) {
        const { stdout } = await run(
          "ffmpeg",
          [
            "-v",
            "error",
            "-i",
            restored,
            "-t",
            "0.8",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-f",
            "f32le",
            "pipe:1",
          ],
          { encoding: "buffer" },
        );
        function energy(frequency: number) {
          let sine = 0,
            cosine = 0;
          for (let index = 0; index < stdout.length / 4; index++) {
            const sample = stdout.readFloatLE(index * 4);
            const phase = (2 * Math.PI * frequency * index) / 16000;
            sine += sample * Math.sin(phase);
            cosine += sample * Math.cos(phase);
          }
          return sine * sine + cosine * cosine;
        }
        assert.ok(
          energy(440) > energy(880) * 20,
          "Source audio replaces the generated soundtrack",
        );
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("phone display rotation survives upload probing and clip normalization without stretching", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "recast-rotation-test-"));
  try {
    const encoded = path.join(dir, "landscape.mp4");
    const rotated = path.join(dir, "phone-portrait.mp4");
    await run("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=320x180:r=24:d=4",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      encoded,
    ]);
    const help = await run("ffmpeg", ["-hide_banner", "-h", "long"]);
    const displayRotation = help.stdout.includes("-display_rotation");
    await run("ffmpeg", [
      "-v",
      "error",
      "-y",
      ...(displayRotation ? ["-display_rotation:v:0", "90"] : []),
      "-i",
      encoded,
      "-c",
      "copy",
      ...(!displayRotation ? ["-metadata:s:v:0", "rotate=90"] : []),
      rotated,
    ]);
    const source = await probe(rotated);
    assert.deepEqual([source.width, source.height], [180, 320]);
    const normalized = await trimVideo(rotated, 0, 4);
    try {
      assert.deepEqual(
        [normalized.meta.width, normalized.meta.height],
        [720, 1280],
      );
      assert.ok(Math.abs(normalized.meta.duration - 4) < 0.05);
    } finally {
      await rm(normalized.dir, { recursive: true, force: true });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
