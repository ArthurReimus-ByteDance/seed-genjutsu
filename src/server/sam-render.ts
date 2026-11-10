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
import type { MaskAnalysis } from "@/lib/sam-verification";
import { probe } from "./media";
import { ProviderError } from "./providers";

const run = promisify(execFile);

function validatedMasks(
  segmentation: VideoSegmentationResult,
  { width, height, count }: { width: number; height: number; count: number },
) {
  if (
    ![width, height, count].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    ) ||
    width * height > 1_000_000 ||
    count > 720 ||
    segmentation.outcome.status !== "completed" ||
    segmentation.diagnostics.some(
      (diagnostic) => diagnostic.severity === "error",
    )
  )
    throw new ProviderError("Meta returned incomplete or invalid masks.");
  const masks = recordsOfKind(segmentation.records, "mask");
  const latest = new Map<string, (typeof masks)[number]>();
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
    latest.set(index + "/" + mask.objectId, mask);
  }
  return [...latest.values()];
}

export function analyzeMasks(
  segmentation: VideoSegmentationResult,
  geometry: { width: number; height: number; count: number },
): MaskAnalysis {
  const masks = validatedMasks(segmentation, geometry);
  let foregroundPixels = 0;
  const visibleFrames = new Set<number>();
  const objects = new Set<string>();
  const confidences: number[] = [];
  for (const mask of masks) {
    const pixels = decodeMaskToRaster(mask.mask).reduce(
      (total, value) => total + (value ? 1 : 0),
      0,
    );
    foregroundPixels += pixels;
    if (pixels) {
      visibleFrames.add(mask.frame!.frameIndex);
      objects.add(mask.objectId);
    }
    if (mask.confidence !== undefined) confidences.push(mask.confidence);
  }
  return {
    objects: objects.size,
    maskedFrames: visibleFrames.size,
    totalFrames: geometry.count,
    foregroundPixels,
    minConfidence: confidences.length ? Math.min(...confidences) : null,
    issue: !foregroundPixels
      ? "empty_mask"
      : objects.size !== 1
        ? "multiple_subjects"
        : null,
  };
}

export async function renderMaskedVideo(
  source: string,
  segmentation: VideoSegmentationResult,
  signal?: AbortSignal,
  includeComparison = false,
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
  const geometry = { width, height, count };
  const analysis = analyzeMasks(segmentation, geometry);
  if (!includeComparison && analysis.issue === "empty_mask")
    throw new ProviderError(
      "No subject matched. Use a short description such as 'person in a red jacket' and try a new take.",
    );
  if (!includeComparison && analysis.issue === "multiple_subjects")
    throw new ProviderError(
      "Several subjects matched or tracking changed identity. Describe one subject more specifically, such as 'person in a red jacket', and try a new take.",
    );
  const masks = validatedMasks(segmentation, geometry);
  const frames = new Map<number, typeof masks>();
  for (const mask of masks) {
    const index = mask.frame!.frameIndex;
    frames.set(index, [...(frames.get(index) ?? []), mask]);
  }
  const dir = await mkdtemp(path.join(tmpdir(), "recast-sam-"));
  const output = path.join(dir, "masked.mp4");
  const comparisonFile = path.join(dir, "comparison.mp4");
  try {
    for (let index = 0; index < count; index++) {
      signal?.throwIfAborted();
      const pixels = Buffer.alloc(width * height);
      for (const record of frames.get(index) ?? []) {
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
          for (let column = 0; column < w; column++)
            if (crop[row * w + column])
              pixels[(top + row) * width + left + column] = 255;
      }
      // Missing frame indices mean no visible subject. Never reuse the last mask.
      await sharp(pixels, { raw: { width, height, channels: 1 } })
        .png({ compressionLevel: 3 })
        .toFile(
          path.join(dir, "mask-" + String(index).padStart(6, "0") + ".png"),
        );
    }
    const scale = Math.min(1, 960 / width, 720 / height);
    const panelWidth = Math.max(2, Math.floor((width * scale) / 2) * 2);
    const panelHeight = Math.max(2, Math.floor((height * scale) / 2) * 2);
    const filter = includeComparison
      ? `[0:v]setpts=PTS-STARTPTS,format=gbrp,split=3[base][left][overlaybase];color=c=0x808080:s=${width}x${height}:r=24,format=gbrp[neutral];[1:v]format=gbrp,split=2[mask][overlaymask];[base][neutral][mask]maskedmerge,format=yuv420p[out];color=c=0xff0000:s=${width}x${height}:r=24,format=gbrp[red];[overlaymask]lutrgb=r=val*0.45:g=val*0.45:b=val*0.45[alpha];[overlaybase][red][alpha]maskedmerge[right];[left][right]hstack=inputs=2,scale=${panelWidth * 2}:${panelHeight},format=yuv420p[comparison]`
      : `[0:v]setpts=PTS-STARTPTS,format=gbrp[base];color=c=0x808080:s=${width}x${height}:r=24,format=gbrp[neutral];[1:v]format=gbrp[mask];[base][neutral][mask]maskedmerge,format=yuv420p[out]`;
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
        filter,
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
        ...(includeComparison
          ? [
              "-map",
              "[comparison]",
              "-an",
              "-frames:v",
              String(count),
              "-c:v",
              "libx264",
              "-preset",
              "fast",
              "-crf",
              "25",
              "-maxrate",
              "4M",
              "-bufsize",
              "8M",
              "-movflags",
              "+faststart",
              comparisonFile,
            ]
          : []),
      ],
      { timeout: 180000, signal, maxBuffer: 1024 * 1024 },
    );
    const comparison = includeComparison
      ? {
          data: await readFile(comparisonFile),
          meta: await probe(comparisonFile),
        }
      : null;
    if (comparison && comparison.data.length > 50_000_000)
      throw new ProviderError(
        "The mask comparison video exceeds the verifier's 50 MB limit.",
      );
    return {
      file: output,
      dir,
      data: await readFile(output),
      meta: await probe(output),
      analysis,
      comparison,
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}
