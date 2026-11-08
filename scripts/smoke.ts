import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { request as httpRequest } from "node:http";
nextEnv.loadEnvConfig(process.cwd());
const { env } = await import("../src/env");
const { workspace } = await import("../src/server/workspace");
const { jobRecord, updateJob } = await import("../src/server/jobs");
const { localPath, getMedia } = await import("../src/server/storage");
const { probe } = await import("../src/server/media");
const { samCheckpointStore } = await import("../src/server/meta-sam");
const { maskLine } = await import("./fixtures/meta-sam");
const { jobSchema, uploadSchema } = await import("../src/lib/schemas");
const base = process.argv[2] ?? env.APP_URL;
const checks: string[] = [];
if (
  env.META_API_KEY ||
  env.BYTEPLUS_API_KEY ||
  env.BYTEPLUS_ACCESS_KEY ||
  env.BYTEPLUS_SECRET_KEY
)
  throw new Error(
    "Run on a disposable instance with Meta, ModelArk and Virtual Portrait keys unset. No paid provider is called.",
  );
if (
  await workspace.read(
    (state) => Object.keys(state.jobs).length + Object.keys(state.media).length,
  )
)
  throw new Error(
    "Use an empty, disposable MEDIA_ROOT for runtime smoke checks. Existing takes and uploads were left untouched.",
  );
const request = async (
  endpoint: string,
  status: number,
  options: RequestInit = {},
) => {
  const response = await fetch(base + "/api" + endpoint, {
    ...options,
    headers: { Origin: new URL(env.APP_URL).origin, ...options.headers },
    redirect: "manual",
    signal: AbortSignal.timeout(120000),
  });
  assert.equal(response.status, status, endpoint + ": " + response.status);
  assert.equal(
    response.headers.get("set-cookie"),
    null,
    "No account/session cookie should be set",
  );
  checks.push((options.method ?? "GET") + " " + endpoint + " → " + status);
  return response;
};
const json = async (endpoint: string, status: number, input?: unknown) =>
  (
    await request(
      endpoint,
      status,
      input === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          },
    )
  ).json();
async function until(id: string, status: string) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const job = jobSchema.parse((await json("/jobs/" + id, 200)).job);
    if (job.status === status) return job;
    if (
      ["failed", "cancelled", "needs_attention", "succeeded"].includes(
        job.status,
      )
    )
      throw new Error(
        "Expected " + status + ", received " + job.status + ": " + job.error,
      );
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Worker did not reach " + status);
}
const dir = await mkdtemp(path.join(tmpdir(), "recast-local-smoke-"));
try {
  const health = await json("/health", 200);
  assert.equal(health.persistence, "files");
  const capabilities = await json("/capabilities", 200);
  assert.equal(capabilities.promptEnhancement, false);
  const enhanceInput = {
    prompt: "Make the performer a silver robot.",
    model: "seedance-2",
    target: "person",
    prepareImage: false,
    preserveAudio: true,
  };
  const missingEnhancer = await json("/prompts/enhance", 503, enhanceInput);
  assert.equal(missingEnhancer.error.code, "PROMPT_SETUP");
  await json("/prompts/enhance", 400, { ...enhanceInput, prompt: " " });
  await request("/prompts/enhance", 405);
  await request("/prompts/enhance", 403, {
    method: "POST",
    headers: {
      Origin: "https://untrusted.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(enhanceInput),
  });
  assert.equal(
    await workspace.read(
      (state) =>
        Object.keys(state.jobs).length + Object.keys(state.media).length,
    ),
    0,
  );
  await json("/jobs", 200);
  for (const endpoint of [
    "/auth/session",
    "/auth/login",
    "/auth/register",
    "/auth/logout",
  ])
    await request(
      endpoint,
      404,
      endpoint.endsWith("session") ? {} : { method: "POST" },
    );
  await request("/jobs", 403, {
    method: "POST",
    headers: { Origin: "https://untrusted.example" },
    body: "{}",
  });
  await request("/jobs", 403, { headers: { "sec-fetch-site": "cross-site" } });
  // Fetch rewrites Host; use an actual HTTP request for this boundary check.
  const foreignHostStatus = await new Promise<number | undefined>(
    (resolve, reject) => {
      const call = httpRequest(
        base + "/api/jobs",
        {
          headers: { host: "untrusted.example:" + new URL(env.APP_URL).port },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      call.on("error", reject);
      call.end();
    },
  );
  assert.equal(foreignHostStatus, 403);
  checks.push("Foreign Host header → 403");
  await request("/jobs/" + randomUUID(), 404);
  await promisify(execFile)("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=44100",
    "-t",
    "6",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    path.join(dir, "source.mp4"),
  ]);
  async function upload(
    kind: string,
    name: string,
    data: Buffer,
    mime: string,
  ) {
    const form = new FormData();
    form.set("kind", kind);
    form.set("file", new File([new Uint8Array(data)], name, { type: mime }));
    return uploadSchema.parse(
      (
        await (
          await request("/uploads", 201, { method: "POST", body: form })
        ).json()
      ).upload,
    );
  }
  const video = await upload(
    "video",
    "source.mp4",
    await readFile(path.join(dir, "source.mp4")),
    "video/mp4",
  );
  const character = await upload(
    "character",
    "character.jpg",
    await readFile("public/samples/character.jpg"),
    "image/jpeg",
  );
  const invalid = new FormData();
  invalid.set("kind", "video");
  invalid.set(
    "file",
    new File(["not a video"], "invalid.mp4", { type: "video/mp4" }),
  );
  await request("/uploads", 400, { method: "POST", body: invalid });
  const media = await request("/media/" + video.id, 206, {
    headers: { Range: "bytes=0-99" },
  });
  assert.equal((await media.arrayBuffer()).byteLength, 100);
  const download = await request("/media/" + video.id + "?download=1", 200);
  assert.match(download.headers.get("content-disposition") ?? "", /attachment/);
  const input = {
    sourceId: video.id,
    characterId: character.id,
    prompt: "Replace the performer and preserve the scene.",
    target: "person",
    start: 1,
    duration: 4,
    resolution: "480p",
    prepareImage: false,
    preserveAudio: true,
  };
  await json("/jobs", 400, { ...input, start: 4 });
  await json("/jobs", 400, { ...input, duration: 31 });
  for (const change of [
    { model: "unknown" },
    { duration: 16 },
    { duration: 4.5 },
  ]) {
    const invalidModel = await json("/jobs", 400, { ...input, ...change });
    assert.equal(invalidModel.error.code, "VALIDATION");
  }
  await json("/jobs", 404, { ...input, sourceId: randomUUID() });
  const create = async () =>
    jobSchema.parse((await json("/jobs", 202, input)).job);
  const job = await create();
  await json("/jobs/" + job.id + "/approve", 409, {});
  const failed = await until(job.id, "failed");
  assert.match(failed.error ?? "", /Meta Model API key/);
  assert.ok(failed.frame);
  const stored = await jobRecord(job.id);
  assert.equal(failed.config.model, "seedance-2");
  assert.equal(stored.seedance_model_id, env.SEEDANCE_2_MODEL);
  const prepared = await probe(
    await localPath(await getMedia(stored.prepared_id!)),
  );
  assert.ok(Math.abs(prepared.duration - 4) < 0.15);
  assert.ok(prepared.hasAudio);
  assert.ok(prepared.width * prepared.height >= 407696);
  checks.push(
    "Worker persisted a real trimmed clip, first frame and source audio without PostgreSQL",
  );
  const ambiguous = await create();
  await updateJob(ambiguous.id, {
    submission_started_at: new Date().toISOString(),
    stage: "submitting",
    status: "processing",
    lease_owner: "stopped-worker",
    lease_until: Date.now() - 1,
  });
  const attention = await until(ambiguous.id, "needs_attention");
  assert.match(attention.error ?? "", /submission was interrupted/);
  assert.equal((await jobRecord(ambiguous.id)).provider_task_id, null);
  checks.push(
    "Expired worker lease recovered; interrupted submission did not create a provider task",
  );
  const recovered = await create();
  await samCheckpointStore(recovered.id).update((state) => {
    state.response = {
      responseId: "resp_synthetic_checkpoint",
      output: maskLine(0, prepared.width, prepared.height),
    };
  });
  await updateJob(recovered.id, {
    prepared_id: stored.prepared_id,
    frame_id: stored.frame_id,
    status: "processing",
    stage: "masking",
    submission_started_at: new Date().toISOString(),
    lease_owner: "stopped-worker",
    lease_until: Date.now() - 1,
  });
  const recoveredReview = await until(recovered.id, "awaiting_approval");
  assert.ok(recoveredReview.masked);
  assert.notEqual(recoveredReview.masked.id, stored.prepared_id);
  assert.equal((await jobRecord(recovered.id)).submission_started_at, null);
  assert.equal(
    (await jobRecord(recovered.id)).meta_response_id,
    "resp_synthetic_checkpoint",
  );
  assert.ok(Math.abs((recoveredReview.masked.duration ?? 0) - 4) < 0.15);
  await request("/media/" + recoveredReview.masked.id, 200);
  assert.equal(
    (await json("/jobs/" + recovered.id, 200)).job.masked.id,
    recoveredReview.masked.id,
  );
  await json("/jobs/" + recovered.id + "/cancel", 200, {});
  checks.push(
    "Completed synthetic SAM checkpoint recovered without a provider POST, rendered a real masked MP4 and persisted the review gate",
  );
  const cancellable = jobSchema.parse(
    (await json("/jobs", 202, { ...input, model: "seedance-2.5" })).job,
  );
  assert.equal(cancellable.config.model, "seedance-2.5");
  assert.equal(
    (await jobRecord(cancellable.id)).seedance_model_id,
    env.SEEDANCE_2_5_MODEL,
  );
  await json("/jobs/" + cancellable.id + "/cancel", 200, {});
  await until(cancellable.id, "cancelled");
  const review = await create();
  await updateJob(review.id, {
    status: "awaiting_approval",
    stage: "review",
    masked_id: stored.prepared_id,
    lease_owner: null,
    lease_until: null,
  });
  await json("/jobs/" + review.id + "/approve", 200, {});
  await json("/jobs/" + review.id + "/approve", 409, {});
  assert.match(
    (await until(review.id, "failed")).error ?? "",
    /Virtual Portrait/,
  );
  const waiting = [];
  for (let i = 0; i < env.MAX_ACTIVE_JOBS; i++) {
    const item = await create();
    await updateJob(item.id, {
      status: "awaiting_approval",
      stage: "review",
      masked_id: stored.prepared_id,
      lease_owner: null,
      lease_until: null,
    });
    waiting.push(item);
  }
  await json("/jobs", 429, input);
  for (const item of waiting) {
    await json("/jobs/" + item.id + "/cancel", 200, {});
    await json("/jobs/" + item.id + "/approve", 409, {});
  }
  const fresh = await fetch(base + "/api/jobs");
  assert.equal(fresh.status, 200);
  const history = await fresh.json();
  assert.ok(history.jobs.some((item: { id: string }) => item.id === job.id));
  assert.equal(
    history.jobs.find((item: { id: string }) => item.id === cancellable.id)
      .config.model,
    "seedance-2.5",
  );
  const disk = JSON.parse(await readFile(workspace.file, "utf8"));
  assert.equal(disk.jobs[job.id].status, "failed");
  assert.ok(disk.media[video.id]);
  checks.push(
    "A fresh cookie-free client reads saved history; uploads and state are present in workspace.json",
  );
  await mkdir("output", { recursive: true });
  await writeFile(
    "output/smoke-results.json",
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        base,
        persistence: "local JSON files",
        checks,
        paidGeneration:
          "Not executed; provider credentials deliberately unset.",
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: " +
      checks.length +
      " local API/worker checks; no authentication, database or provider calls.",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
