import {
  decodeMaskToRaster,
  recordsOfKind,
  type VideoSegmentationResult,
} from "@meta-sam/parser";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { probe } from "./media";
import { ProviderError } from "./providers";

const run = promisify(execFile);

export async function renderMaskedVideo(
  source: string,
  segmentation: VideoSegmentationResult,
  signal?: AbortSignal,
) {
  const { stdout } = await run(
    "ffprobe",
    [
      "-v",
      "error",
      "-count_frames",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,nb_read_frames,avg_frame_rate",
      "-of",
      "json",
      source,
    ],
    { timeout: 60000, signal },
  );
  const stream = JSON.parse(stdout).streams?.[0];
  const width = Number(stream?.width),
    height = Number(stream?.height);
  const count = Number(stream?.nb_read_frames);
  const [num, den] = String(stream?.avg_frame_rate).split("/").map(Number);
  if (
    ![width, height, count].every((n) => Number.isSafeInteger(n) && n > 0) ||
    width * height > 1_000_000 ||
    count > 720 ||
    num / den !== 24
  )
    throw new ProviderError(
      "Prepare a 4–30 second, 24 fps clip before rendering SAM masks.",
    );
  if (
    segmentation.outcome.status !== "completed" ||
    segmentation.diagnostics.length
  )
    throw new ProviderError(
      "Meta returned incomplete or invalid masks. Review the source and subject description before starting another take.",
    );
  const masks = recordsOfKind(segmentation.records, "mask");
  if (!masks.length)
    throw new ProviderError(
      "No subject matched. Use a short description such as 'person in a red jacket' and try a new take.",
    );
  if (new Set(masks.map((mask) => mask.objectId)).size !== 1)
    throw new ProviderError(
      "Several subjects matched or tracking changed identity. Describe one subject more specifically, such as 'person in a red jacket', and try a new take.",
    );
  const frames = new Map<number, (typeof masks)[number]>();
  for (const mask of masks) {
    const index = mask.frame?.frameIndex;
    const { left, top, right, bottom } = mask.bounds;
    if (
      index === undefined ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= count ||
      ![left, top, right, bottom, mask.mask.width, mask.mask.height].every(
        Number.isSafeInteger,
      ) ||
      left < 0 ||
      top < 0 ||
      right > width ||
      bottom > height ||
      right <= left ||
      bottom <= top ||
      mask.mask.width <= 0 ||
      mask.mask.height <= 0 ||
      mask.mask.width * mask.mask.height > width * height
    )
      throw new ProviderError(
        "Meta returned a mask outside the prepared clip's frame or pixel bounds.",
      );
    // A repeated record is a revision of this frame, not another video frame.
    frames.set(index, mask);
  }
  const dir = await mkdtemp(path.join(tmpdir(), "recast-sam-"));
  const output = path.join(dir, "masked.mp4");
  try {
    for (let index = 0; index < count; index++) {
      signal?.throwIfAborted();
      const pixels = Buffer.alloc(width * height);
      const record = frames.get(index);
      if (record) {
        const { left, top, right, bottom } = record.bounds;
        const w = right - left,
          h = bottom - top;
        const raster = Buffer.from(decodeMaskToRaster(record.mask)).map(
          (value) => (value ? 255 : 0),
        );
        const crop =
          record.mask.width === w && record.mask.height === h
            ? raster
            : await sharp(raster, {
                raw: {
                  width: record.mask.width,
                  height: record.mask.height,
                  channels: 1,
                },
              })
                .resize(w, h, { kernel: "nearest" })
                .greyscale()
                .raw()
                .toBuffer();
        for (let row = 0; row < h; row++)
          pixels.set(
            crop.subarray(row * w, (row + 1) * w),
            (top + row) * width + left,
          );
      }
      // Missing frame indices mean no visible subject. Never reuse the last mask.
      await sharp(pixels, { raw: { width, height, channels: 1 } })
        .png({ compressionLevel: 3 })
        .toFile(
          path.join(dir, "mask-" + String(index).padStart(6, "0") + ".png"),
        );
    }
    await run(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        source,
        "-framerate",
        "24",
        "-i",
        path.join(dir, "mask-%06d.png"),
        "-filter_complex",
        `[0:v]setpts=PTS-STARTPTS,format=gbrp[base];color=c=0x808080:s=${width}x${height}:r=24,format=gbrp[neutral];[1:v]format=gbrp[mask];[base][neutral][mask]maskedmerge,format=yuv420p[out]`,
        "-map",
        "[out]",
        "-an",
        "-frames:v",
        String(count),
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "18",
        "-movflags",
        "+faststart",
        output,
      ],
      { timeout: 180000, signal, maxBuffer: 1024 * 1024 },
    );
    return {
      file: output,
      dir,
      data: await readFile(output),
      meta: await probe(output),
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}
