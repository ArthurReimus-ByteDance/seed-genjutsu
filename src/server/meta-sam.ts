import {
  formats,
  parseVideoStream,
  type VideoSegmentationResult,
} from "@meta-sam/parser";
import { createParser } from "eventsource-parser";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { env } from "@/env";
import {
  maskAnalysisSchema,
  samRefinementSchema,
  samVerificationSchema,
} from "@/lib/sam-verification";
import { AppError } from "./http";
import { JsonFileStore } from "./json-file";
import { ProviderError } from "./providers";

const endpoint = "https://api.meta.ai/v1/responses";
const outputLimit = 64 * 1024 * 1024;
// The encoded video plus JSON must fit Meta's 50 MB inline request limit.
const inlineVideoLimit = 32 * 1024 * 1024;
const run = promisify(execFile);

export async function samVideoDataUrl(file: string, signal?: AbortSignal) {
  const dir = await mkdtemp(path.join(tmpdir(), "recast-sam-input-"));
  const video = path.join(dir, "video.mp4");
  try {
    // Copy the prepared video track so mask frame indices still match the source.
    await run(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-i",
        file,
        "-map",
        "0:v:0",
        "-c:v",
        "copy",
        "-an",
        "-map_metadata",
        "-1",
        "-map_chapters",
        "-1",
        "-movflags",
        "+faststart",
        video,
      ],
      { timeout: 30_000, signal },
    );
    if ((await stat(video)).size > inlineVideoLimit)
      throw new AppError(
        413,
        "META_VIDEO_LIMIT",
        "The prepared video is too large for SAM. Choose a shorter clip and create a new take.",
      );
    const data = await readFile(video, { signal });
    return "data:video/mp4;base64," + data.toString("base64");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const checkpointSchema = z.object({
  version: z.literal(1),
  response: z
    .object({
      responseId: z.string().nullable(),
      output: z.string().max(outputLimit),
    })
    .nullable(),
  refinementStartedAt: z.iso.datetime().optional(),
  refinement: samRefinementSchema.optional(),
  maskedId: z.uuid().optional(),
  comparisonId: z.uuid().optional(),
  analysis: maskAnalysisSchema.optional(),
  verificationStartedAt: z.iso.datetime().optional(),
  verification: samVerificationSchema.optional(),
});

// Keep large mask payloads outside the frequently rewritten workspace index.
export function samCheckpointStore(
  jobId: string,
  root = env.MEDIA_ROOT,
  attempt = 0,
) {
  z.uuid().parse(jobId);
  z.number().int().min(0).max(1).parse(attempt);
  return new JsonFileStore(
    path.resolve(root, "sam", jobId + (attempt ? ".retry-1" : "") + ".json"),
    checkpointSchema,
    () => ({ version: 1 as const, response: null }),
  );
}

export function parseSavedMasks(output: string): VideoSegmentationResult {
  const parser = formats.segmentation.video().createParser();
  parser.push(output, { emit: false });
  return parser.finish({ status: "completed" }).result;
}

export async function segmentVideo(
  videoUrl: string,
  target: string,
  signal?: AbortSignal,
  options: {
    apiKey?: string;
    request?: typeof fetch;
    onResponseId?: (id: string) => Promise<void>;
  } = {},
) {
  const key = options.apiKey ?? env.META_API_KEY;
  if (!key)
    throw new AppError(
      503,
      "META_SETUP",
      "SAM 3.1 needs your Meta Model API key. Add META_API_KEY, restart the server and worker, then create a new take.",
    );
  let response: Response;
  try {
    // Deliberately one POST, without SDK retries for this billable operation.
    response = await (options.request ?? fetch)(endpoint, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: "sam-3.1",
        input: [
          {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: target },
              { type: "input_video", video_url: videoUrl },
            ],
          },
        ],
        stream: true,
        metadata: { mask_encoding: "one_bit" },
      }),
      redirect: "error",
      signal: AbortSignal.any([
        AbortSignal.timeout(10 * 60 * 1000),
        ...(signal ? [signal] : []),
      ]),
    });
  } catch {
    throw new ProviderError(
      "The Meta SAM submission was not confirmed. Check Meta usage before retrying.",
      true,
    );
  }
  if (!response.ok) {
    let code = "";
    try {
      const data = await response.json();
      code = String(data?.error?.code ?? "")
        .replace(/[^a-zA-Z0-9_.-]/g, "")
        .slice(0, 100);
    } catch {
      // Provider bodies may contain signed URLs or account information. Never expose them.
    }
    throw new ProviderError(
      response.status === 402
        ? "Meta SAM requires active billing or available credits. Check billing in the Meta developer console, then create a new take."
        : code === "media_url_not_fetchable"
          ? "Meta could not read the video reference. Restart the updated worker to use inline video input, then create a new take."
          : "Meta rejected the SAM request (" +
            response.status +
            (code ? ": " + code : "") +
            "). Check SAM 3.1 access and video eligibility.",
      response.status >= 500,
      response.status === 429,
      response.status,
    );
  }
  if (
    !response.body ||
    !response.headers.get("content-type")?.includes("text/event-stream")
  ) {
    await response.body?.cancel();
    throw new ProviderError(
      "Meta returned no segmentation stream. Check Meta usage before retrying.",
      true,
    );
  }
  let responseId: string | null = null;
  async function* events() {
    const pending: { type: string; [key: string]: unknown }[] = [];
    const decoder = new TextDecoder();
    let size = 0;
    const parser = createParser({
      maxBufferSize: 4 * 1024 * 1024,
      onError: () => {
        throw new Error("Invalid Meta event stream");
      },
      onEvent: ({ data }) => {
        if (data === "[DONE]") return;
        const value = JSON.parse(data);
        if (!value || typeof value.type !== "string")
          throw new Error("Invalid Meta event");
        pending.push(value);
      },
    });
    for await (const chunk of response.body!) {
      size += chunk.byteLength;
      if (size > outputLimit) throw new Error("Meta output limit exceeded");
      parser.feed(decoder.decode(chunk, { stream: true }));
      while (pending.length) {
        const event = pending.shift()!;
        if (event.type === "response.created") {
          const id = (event.response as { id?: unknown } | undefined)?.id;
          if (typeof id === "string" && id.length <= 200) {
            responseId = id;
            await options.onResponseId?.(id);
          }
        }
        yield event;
      }
    }
    parser.feed(decoder.decode());
  }
  try {
    const result = await parseVideoStream(events()).finalResult;
    if (result.outcome.status !== "completed")
      throw new ProviderError(
        "Meta segmentation ended before completion. Check Meta usage before starting another take.",
        true,
      );
    return { result, responseId };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      "The Meta segmentation stream was interrupted or invalid. Check Meta usage before starting another take.",
      true,
    );
  }
}
