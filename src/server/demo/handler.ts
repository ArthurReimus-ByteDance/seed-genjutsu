import { randomUUID } from "node:crypto";
import { readFile, writeFile, unlink, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { z } from "zod";
import { DOWNLOAD_PREFIX, SEEDREAM_NAME } from "@/lib/branding";
import { DEFAULT_VIDEO_MODEL, videoModels } from "@/lib/video-models";
import { createJobSchema, type Job } from "@/lib/schemas";
import {
  effectiveDirection,
  workflowIds,
  workflows,
  stylePresetIds,
  stylePresets,
  STYLE_PRESET_REVISION,
} from "@/lib/workflows";
import { AppError, ok, readJson, readFormData, route } from "@/server/http";
import { fileResponse } from "@/server/media-response";
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
  resolveDemoInputs,
  presentDemoJob,
  reviewDemoMedia,
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
  const form = await readFormData(request);
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
          workflows: workflowIds.map((id) => ({
            id,
            label: workflows[id].label,
            model: id === "character_swap" ? null : "seedance-2.5",
            requiresSam: id === "character_swap",
            maxImageReferences: id === "character_swap" ? 1 : 30,
            configured: true,
            qualityValidated: false,
          })),
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
      if (method === "GET" && endpoint === "presets") {
        const workflow = new URL(request.url).searchParams.get("workflow");
        if (workflow && workflow !== "restyle")
          throw new AppError(
            400,
            "INVALID_WORKFLOW",
            "Style presets are available for the restyle workflow.",
          );
        return ok({
          presets: stylePresetIds.map((id) => ({
            id,
            revision: STYLE_PRESET_REVISION,
            ...stylePresets[id],
            qualityValidated: false,
          })),
        });
      }
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
        return fileResponse(request, item.file, headers);
      }
      if (method === "GET" && endpoint === "jobs")
        return ok({
          jobs: store.jobs
            .map((record) => presentDemoJob(store, record))
            .reverse(),
        });
      if (method === "POST" && endpoint === "jobs") {
        if (store.jobs.length >= 30)
          throw new AppError(
            429,
            "PREVIEW_LIMIT",
            "This preview has reached its take limit.",
          );
        const config = createJobSchema.parse(await readJson(request));
        const { source, character, references } = resolveDemoInputs(
          store,
          config,
        );
        const characterSwap = config.workflow === "character_swap";
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
          name:
            DOWNLOAD_PREFIX +
            "-simulated-prerecorded-" +
            jobId.slice(0, 8) +
            ".mp4",
          mime: "video/mp4",
          file: resultFile,
          bytes: resultBytes.length,
          ...resultMeta,
          duration: resultMeta.duration,
          posterUrl: "/samples/character.jpg",
        });
        const trimmed = await trimVideo(
          source.file,
          config.start,
          config.duration,
        );
        let reviewVideo, firstFrame;
        try {
          const image = await frame(trimmed.file);
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
          reviewVideo = await saveDemoMedia(store, {
            kind: characterSwap ? "masked" : "prepared",
            name: characterSwap
              ? "Simulated subject preview.mp4"
              : "Original prepared clip.mp4",
            mime: "video/mp4",
            data: trimmed.data,
            bytes: trimmed.data.length,
            ...trimmed.meta,
            duration: trimmed.meta.duration,
            posterUrl: firstFrame.url,
          });
        } finally {
          await rm(trimmed.dir, { recursive: true, force: true });
        }
        const anchor = characterSwap
          ? await saveDemoMedia(store, {
              kind: "anchor",
              name: "Simulated scene look.jpg",
              mime: "image/jpeg",
              bytes: 180000,
              width: 1280,
              height: 720,
              duration: null,
              file: path.join(process.cwd(), "public/samples/character.jpg"),
            })
          : null;
        const now = new Date().toISOString();
        const job: Job = {
          id: jobId,
          name: effectiveDirection(config).slice(0, 60),
          prompt: config.prompt,
          config,
          status: "queued",
          stage: "queued",
          progress: 5,
          source: publicDemoMedia(source),
          character: character ? publicDemoMedia(character) : null,
          references,
          prepared: null,
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
              message:
                "Preview take created. All model steps are simulated; outputs use a fixed prerecorded sample. This preview does not validate real-person authorization, media rights, provider eligibility or model output quality.",
              createdAt: now,
            },
          ],
        };
        store.jobs.push({
          job,
          scenario,
          approvedAt: null,
          prepared: characterSwap ? null : publicDemoMedia(reviewVideo),
          masked: characterSwap ? publicDemoMedia(reviewVideo) : null,
          anchor: anchor ? publicDemoMedia(anchor) : null,
          result: publicDemoMedia(result),
        });
        return ok({ job }, 202);
      }
      if (parts[0] === "jobs" && parts[1]) {
        z.uuid().parse(parts[1]);
        const record = demoJob(store, parts[1]);
        if (method === "GET" && parts.length === 2)
          return ok({ job: presentDemoJob(store, record) });
        if (method === "POST" && parts[2] === "approve") {
          if (record.job.status !== "awaiting_approval")
            throw new AppError(
              409,
              "NOT_AWAITING_APPROVAL",
              "This take is not waiting for review.",
            );
          reviewDemoMedia(store, record);
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
          return ok({ job: presentDemoJob(store, record) });
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
