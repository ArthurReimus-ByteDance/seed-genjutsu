import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { AppError } from "./http";
const run = promisify(execFile);
export async function probe(file: string) {
  let stdout: string;
  try {
    ({ stdout } = await run(
      "ffprobe",
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
      { timeout: 30000, maxBuffer: 1048576 },
    ));
  } catch {
    throw new AppError(
      400,
      "INVALID_VIDEO",
      "Upload a valid MP4 or MOV video.",
    );
  }
  const data = JSON.parse(stdout);
  const stream = data.streams.find(
    (s: { codec_type: string }) => s.codec_type === "video",
  );
  if (!stream)
    throw new AppError(
      400,
      "INVALID_VIDEO",
      "Upload a video with a readable video track.",
    );
  const duration = Number(data.format.duration);
  const rotation = Number(
    stream.side_data_list?.find((item: { rotation?: number }) =>
      Number.isFinite(item.rotation),
    )?.rotation ??
      stream.tags?.rotate ??
      0,
  );
  // ffmpeg applies the display matrix before scaling. Report those same
  // display dimensions so a rotated phone clip keeps its portrait aspect.
  const quarterTurn =
    Number.isFinite(rotation) && Math.abs(rotation % 180) === 90;
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isInteger(stream.width) ||
    !Number.isInteger(stream.height) ||
    stream.width <= 0 ||
    stream.height <= 0 ||
    stream.width * stream.height > 36_000_000
  )
    throw new AppError(
      400,
      "INVALID_VIDEO",
      "This video format or size is not supported.",
    );
  return {
    width: Number(quarterTurn ? stream.height : stream.width),
    height: Number(quarterTurn ? stream.width : stream.height),
    duration,
    hasAudio: data.streams.some(
      (s: { codec_type: string }) => s.codec_type === "audio",
    ),
  };
}
export async function normalizeImage(data: Buffer) {
  try {
    const image = sharp(data, { limitInputPixels: 36_000_000 }).rotate();
    const result = await image
      .resize({
        width: 2048,
        height: 2048,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 92 })
      .toBuffer({ resolveWithObject: true });
    return {
      data: result.data,
      width: result.info.width,
      height: result.info.height,
    };
  } catch {
    throw new AppError(
      400,
      "INVALID_IMAGE",
      "Upload a valid JPG, PNG or WebP image.",
    );
  }
}
export async function frame(file: string, start = 0) {
  const { stdout } = await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(start),
      "-i",
      file,
      "-frames:v",
      "1",
      "-vf",
      "scale=1024:-2",
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "pipe:1",
    ],
    { timeout: 30000, maxBuffer: 20 * 1024 * 1024, encoding: "buffer" },
  );
  return normalizeImage(stdout);
}
export async function trimVideo(
  file: string,
  start: number,
  duration: number,
  signal?: AbortSignal,
) {
  const dir = await mkdtemp(path.join(tmpdir(), "recast-trim-"));
  const output = path.join(dir, "clip.mp4");
  try {
    const source = await probe(file);
    const dimensions = referenceDimensions(source.width, source.height);
    await run(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        String(start),
        "-i",
        file,
        "-t",
        String(duration),
        "-vf",
        "scale=" +
          dimensions.width +
          ":" +
          dimensions.height +
          ",setsar=1,fps=24",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "18",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        output,
      ],
      { timeout: 180000, signal },
    );
    return {
      file: output,
      data: await readFile(output),
      meta: await probe(output),
      dir,
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}
export function referenceDimensions(width: number, height: number) {
  const ratio = width / height;
  if (!Number.isFinite(ratio) || ratio < 0.4 || ratio > 2.5)
    throw new AppError(
      400,
      "VIDEO_ASPECT",
      "Choose a video with an aspect ratio between 2:5 and 5:2.",
    );
  // Normalize to approximately 720p area, within Seedance reference limits.
  return {
    width: Math.round(Math.sqrt(921600 * ratio) / 2) * 2,
    height: Math.round(Math.sqrt(921600 / ratio) / 2) * 2,
  };
}
export async function restoreAudio(
  output: string,
  source: string,
  signal?: AbortSignal,
) {
  const dir = await mkdtemp(path.join(tmpdir(), "recast-audio-"));
  const destination = path.join(dir, "result.mp4");
  try {
    await run(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        output,
        "-i",
        source,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0?",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        // Pad an early-ending source soundtrack so -shortest follows the
        // generated video, rather than cutting its final frames away.
        "-af",
        "apad",
        "-shortest",
        "-movflags",
        "+faststart",
        destination,
      ],
      { timeout: 90000, signal },
    );
    return await readFile(destination);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
