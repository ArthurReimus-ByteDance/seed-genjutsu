import { randomUUID } from "node:crypto";
import { readFile, writeFile, unlink, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { z } from "zod";
import { DOWNLOAD_PREFIX, SEEDREAM_NAME } from "@/lib/branding";
import { DEFAULT_VIDEO_MODEL, videoModels } from "@/lib/video-models";
import { createJobSchema, type Job } from "@/lib/schemas";
import { AppError, ok, readJson, route } from "@/server/http";
import { frame, normalizeImage, probe, trimVideo } from "@/server/media";
import {
  withDemo,
  sampleReferences,
  saveDemoMedia,
  publicDemoMedia,
  media,
  demoJob,
  demoRoot,
  type DemoStore,
  requireDemoEnabled,
} from "./store";
import { demoEnhancement } from "./prompt-enhancement";
const run = promisify(execFile);
async function upload(request: Request, store: DemoStore) {
  if (
    store.uploads.filter((i) => i.kind === "video" || i.kind === "character")
      .length >= 30
  )
    throw new AppError(
      429,
      "PREVIEW_LIMIT",
      "This preview has reached its upload limit. Use an existing reference.",
    );
  if (Number(request.headers.get("content-length") ?? 0) > 105 * 1024 * 1024)
    throw new AppError(413, "TOO_LARGE", "Keep videos under 100 MB.");
  const form = await request.formData();
  const kind = z.enum(["video", "character"]).parse(form.get("kind"));
  const file = form.get("file");
  if (!(file instanceof File) || !file.size)
    throw new AppError(400, "FILE_REQUIRED", "Choose a file to upload.");
  if (file.size > (kind === "video" ? 100 : 20) * 1024 * 1024)
    throw new AppError(413, "TOO_LARGE", "This file is too large.");
  const data = Buffer.from(await file.arrayBuffer());
  if (kind === "character") {
    const image = await normalizeImage(data);
    return saveDemoMedia(store, {
      ...image,
      kind,
      name: file.name.slice(0, 180),
      mime: "image/jpeg",
      bytes: image.data.length,
      duration: null,
    });
  }
  const temp = path.join(demoRoot, store.id, randomUUID() + ".mp4");
  await writeFile(temp, data, { mode: 0o600 });
  try {
    const meta = await probe(temp);
    if (meta.duration < 4 || meta.duration > 300)
      throw new AppError(
        400,
        "VIDEO_DURATION",
        "Choose a video between 4 seconds and 5 minutes.",
      );
    const image = await frame(temp);
    const poster = await saveDemoMedia(store, {
      kind: "frame",
      name: "Source poster",
      mime: "image/jpeg",
      data: image.data,
      bytes: image.data.length,
      width: image.width,
      height: image.height,
      duration: null,
    });
    return await saveDemoMedia(store, {
      kind,
      name: file.name.slice(0, 180),
      mime: "video/mp4",
      data,
      bytes: data.length,
      ...meta,
      duration: meta.duration,
      posterUrl: poster.url,
    });
  } finally {
    await unlink(temp).catch(() => {});
  }
}
export async function demoHandler(request: Request, parts: string[]) {
  return route(async () => {
    const method = request.method,
      endpoint = parts.join("/");
    if (method === "POST" && endpoint === "prompts/enhance") {
      requireDemoEnabled();
      const input = await readJson(request);
      // Match the observed text-model latency so editing/cancellation is reviewable.
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return ok({
        enhancement: demoEnhancement(
          input,
          request.headers.get("X-Recast-Scenario"),
        ),
      });
    }
    return withDemo(async (store) => {
      if (method === "GET" && endpoint === "capabilities")
        return ok({
          video: true,
          image: true,
          storage: true,
          portraits: true,
          sam: true,
          promptEnhancement: true,
          promptEnhancerModel: "Preview · simulated",
          seedanceModel: videoModels[DEFAULT_VIDEO_MODEL].providerId,
          defaultVideoModel: DEFAULT_VIDEO_MODEL,
          seedreamModel: SEEDREAM_NAME + " · simulated",
          missing: [],
          workerSeenAt: new Date().toISOString(),
        });
      if (method === "POST" && endpoint === "samples")
        return ok(await sampleReferences(store));
      if (method === "POST" && endpoint === "uploads")
        return ok(
          { upload: publicDemoMedia(await upload(request, store)) },
          201,
        );
      if (method === "GET" && parts[0] === "media" && parts.length === 2) {
        z.uuid().parse(parts[1]);
        const item = media(store, parts[1]);
        const bytes = await readFile(item.file);
        const headers: Record<string, string> = {
          "Content-Type": item.mime,
          "Cache-Control": "private, no-store",
          "Accept-Ranges": "bytes",
        };
        if (new URL(request.url).searchParams.has("download"))
          headers["Content-Disposition"] =
            'attachment; filename="' +
            item.name.replace(/[^a-zA-Z0-9._-]/g, "_") +
            '"';
        const range = request.headers.get("range");
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (!match)
            throw new AppError(416, "INVALID_RANGE", "Invalid video range.");
          const start = match[1]
            ? Number(match[1])
            : Math.max(0, bytes.length - Number(match[2]));
          const end =
            match[1] && match[2]
              ? Math.min(Number(match[2]), bytes.length - 1)
              : bytes.length - 1;
          if (start > end || start >= bytes.length)
            return new Response(null, {
              status: 416,
              headers: { "Content-Range": "bytes */" + bytes.length },
            });
          return new Response(new Uint8Array(bytes.subarray(start, end + 1)), {
            status: 206,
            headers: {
              ...headers,
              "Content-Range":
                "bytes " + start + "-" + end + "/" + bytes.length,
              "Content-Length": String(end - start + 1),
            },
          });
        }
        return new Response(new Uint8Array(bytes), {
          headers: { ...headers, "Content-Length": String(bytes.length) },
        });
      }
      if (method === "GET" && endpoint === "jobs")
        return ok({ jobs: store.jobs.map((record) => record.job).reverse() });
      if (method === "POST" && endpoint === "jobs") {
        if (store.jobs.length >= 30)
          throw new AppError(
            429,
            "PREVIEW_LIMIT",
            "This preview has reached its take limit.",
          );
        const config = createJobSchema.parse(await readJson(request));
        const source = media(store, config.sourceId),
          character = media(store, config.characterId);
        if (source.kind !== "video" || character.kind !== "character")
          throw new AppError(
            400,
            "INVALID_REFERENCE",
            "Choose a video and a character image.",
          );
        if (
          !source.duration ||
          config.start + config.duration > source.duration + 0.06
        )
          throw new AppError(
            400,
            "INVALID_TRIM",
            "The selected range extends past your clip.",
          );
        const scenario = z
          .enum(["success", "failure"])
          .parse(request.headers.get("X-Recast-Scenario") ?? "success");
        const jobId = randomUUID(),
          resultFile = path.join(demoRoot, store.id, jobId + ".mp4");
        await run(
          "ffmpeg",
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-stream_loop",
            "-1",
            "-ss",
            String(config.start % 6),
            "-i",
            path.join(process.cwd(), "public/samples/result.mp4"),
            "-t",
            String(config.duration),
            "-vf",
            "scale=-2:" +
              (config.resolution === "1080p"
                ? "1080"
                : config.resolution === "480p"
                  ? "480"
                  : "720"),
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
            resultFile,
          ],
          { timeout: 60000 },
        );
        const resultMeta = await probe(resultFile);
        const resultBytes = await readFile(resultFile);
        const result = await saveDemoMedia(store, {
          kind: "result",
          name: DOWNLOAD_PREFIX + "-simulated-" + jobId.slice(0, 8) + ".mp4",
          mime: "video/mp4",
          file: resultFile,
          bytes: resultBytes.length,
          ...resultMeta,
          duration: resultMeta.duration,
          posterUrl: "/samples/character.jpg",
        });
        const prepared = await trimVideo(
          source.file,
          config.start,
          config.duration,
        );
        let masked, firstFrame;
        try {
          const image = await frame(prepared.file);
          firstFrame = await saveDemoMedia(store, {
            kind: "frame",
            name: "Original first frame.jpg",
            mime: "image/jpeg",
            data: image.data,
            bytes: image.data.length,
            width: image.width,
            height: image.height,
            duration: null,
          });
          masked = await saveDemoMedia(store, {
            kind: "masked",
            name: "Simulated subject preview.mp4",
            mime: "video/mp4",
            data: prepared.data,
            bytes: prepared.data.length,
            ...prepared.meta,
            duration: prepared.meta.duration,
            posterUrl: firstFrame.url,
          });
        } finally {
          await rm(prepared.dir, { recursive: true, force: true });
        }
        const anchor = await saveDemoMedia(store, {
          kind: "anchor",
          name: "Simulated scene look.jpg",
          mime: "image/jpeg",
          bytes: 180000,
          width: 1280,
          height: 720,
          duration: null,
          file: path.join(process.cwd(), "public/samples/character.jpg"),
        });
        const now = new Date().toISOString();
        const job: Job = {
          id: jobId,
          name: config.prompt.slice(0, 60),
          prompt: config.prompt,
          config,
          status: "queued",
          stage: "queued",
          progress: 5,
          source: publicDemoMedia(source),
          character: publicDemoMedia(character),
          frame: publicDemoMedia(firstFrame),
          masked: null,
          anchor: null,
          result: null,
          error: null,
          createdAt: now,
          updatedAt: now,
          events: [
            {
              id: 1,
              stage: "queued",
              message: "Preview take created. All model steps are simulated.",
              createdAt: now,
            },
          ],
        };
        store.jobs.push({
          job,
          scenario,
          approvedAt: null,
          masked: publicDemoMedia(masked),
          anchor: publicDemoMedia(anchor),
          result: publicDemoMedia(result),
        });
        return ok({ job }, 202);
      }
      if (parts[0] === "jobs" && parts[1]) {
        z.uuid().parse(parts[1]);
        const record = demoJob(store, parts[1]);
        if (method === "GET" && parts.length === 2)
          return ok({ job: record.job });
        if (method === "POST" && parts[2] === "approve") {
          if (record.job.status !== "awaiting_approval")
            throw new AppError(
              409,
              "NOT_AWAITING_APPROVAL",
              "This take is not waiting for review.",
            );
          record.approvedAt = new Date().toISOString();
          record.job = {
            ...record.job,
            status: "processing",
            stage: "registering",
            progress: 50,
            updatedAt: record.approvedAt,
            events: [
              ...record.job.events,
              {
                id: record.job.events.length + 1,
                stage: "registering",
                message:
                  "References approved. Continuing the simulated generation.",
                createdAt: record.approvedAt,
              },
            ],
          };
          return ok({ job: record.job });
        }
        if (method === "POST" && parts[2] === "cancel") {
          if (["succeeded", "failed", "cancelled"].includes(record.job.status))
            throw new AppError(
              409,
              "TERMINAL_JOB",
              "This take has already finished.",
            );
          record.job = {
            ...record.job,
            status: "cancelled",
            stage: "cancelled",
            events: [
              ...record.job.events,
              {
                id: record.job.events.length + 1,
                stage: "cancelled",
                message: "Preview take cancelled. Your references are saved.",
                createdAt: new Date().toISOString(),
              },
            ],
            updatedAt: new Date().toISOString(),
          };
          return ok({ job: record.job });
        }
      }
      throw new AppError(404, "NOT_FOUND", "Preview endpoint not found.");
    });
  }, request);
}
