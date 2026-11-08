import { randomUUID } from "node:crypto";
import { workspace, type StoredJob } from "./workspace";
import { getMedia, publicUpload } from "./storage";
import { AppError } from "./http";
import { env } from "@/env";
import { type CreateJob, type Job } from "@/lib/schemas";
import { providerModelId } from "./video-models";
const runnable = (status: string) =>
  ["queued", "processing", "generating"].includes(status);
const finished = (status: string) =>
  ["succeeded", "failed", "cancelled", "needs_attention"].includes(status);

export async function jobRecord(id: string) {
  return workspace.read((state) => {
    const job = state.jobs[id];
    if (!job) throw new AppError(404, "NOT_FOUND", "Take not found.");
    return job;
  });
}
export async function presentJob(row: StoredJob): Promise<Job> {
  return workspace.read((state) => {
    const get = (id: string | null) =>
      id && state.media[id] ? publicUpload(state.media[id]) : null;
    const source = get(row.source_id),
      character = get(row.character_id);
    if (!source || !character)
      throw new Error("A saved take is missing its references.");
    return {
      id: row.id,
      name: row.name,
      prompt: row.prompt,
      status: row.status,
      stage: row.stage,
      progress: row.progress,
      config: row.config,
      source,
      character,
      frame: get(row.frame_id),
      anchor: get(row.anchor_id),
      masked: get(row.masked_id),
      result: get(row.result_id),
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      events: row.events,
    };
  });
}
export async function listJobs() {
  const rows = await workspace.read((state) =>
    Object.values(state.jobs)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 50),
  );
  return Promise.all(rows.map(presentJob));
}
export async function createJob(input: CreateJob) {
  const source = await getMedia(input.sourceId),
    character = await getMedia(input.characterId);
  if (source.kind !== "video" || character.kind !== "character")
    throw new AppError(
      400,
      "INVALID_INPUT",
      "Choose a source video and a character image.",
    );
  if (!source.duration || input.start + input.duration > source.duration + 0.06)
    throw new AppError(
      400,
      "INVALID_TRIM",
      "The selected range extends past the video.",
    );
  if (input.prepareImage && !env.SEEDREAM_MODEL)
    throw new AppError(
      503,
      "IMAGE_SETUP",
      "The Seedream image model is not connected yet. Disable scene preparation or configure its verified model ID.",
    );
  const job = await workspace.update((state) => {
    const now = Date.now(),
      rows = Object.values(state.jobs);
    if (
      rows.filter(
        (job) => runnable(job.status) || job.status === "awaiting_approval",
      ).length >= env.MAX_ACTIVE_JOBS ||
      rows.filter((job) => Date.parse(job.created_at) > now - 86400000)
        .length >= env.MAX_DAILY_JOBS
    )
      throw new AppError(
        429,
        "GENERATION_LIMIT",
        "Your studio generation limit has been reached.",
      );
    const id = randomUUID(),
      timestamp = new Date(now).toISOString();
    const job: StoredJob = {
      id,
      name: input.prompt.slice(0, 60),
      prompt: input.prompt,
      config: input,
      source_id: source.id,
      character_id: character.id,
      prepared_id: null,
      frame_id: null,
      anchor_id: null,
      masked_id: null,
      result_id: null,
      status: "queued",
      stage: "queued",
      progress: 0,
      error: null,
      created_at: timestamp,
      updated_at: timestamp,
      sam_request_id: null,
      meta_response_id: null,
      provider_task_id: null,
      seedance_model_id: providerModelId(input.model),
      asset_id: null,
      asset_group_id: null,
      submission_started_at: null,
      cancel_requested: false,
      next_run_at: now,
      lease_until: null,
      lease_owner: null,
      attempts: 0,
      events: [
        {
          id: 1,
          stage: "queued",
          message: "Your take is in the processing queue.",
          createdAt: timestamp,
        },
      ],
    };
    state.jobs[id] = job;
    return job;
  });
  return presentJob(job);
}
function appendEvent(job: StoredJob, stage: string, message: string) {
  job.events.push({
    id: job.events.length + 1,
    stage,
    message,
    createdAt: new Date().toISOString(),
  });
}
export async function updateJob(id: string, patch: Partial<StoredJob>) {
  return workspace.update((state) => {
    const job = state.jobs[id];
    if (!job) throw new AppError(404, "NOT_FOUND", "Take not found.");
    Object.assign(job, patch, { updated_at: new Date().toISOString() });
    return job;
  });
}
export async function event(id: string, stage: string, message: string) {
  return workspace.update((state) =>
    appendEvent(state.jobs[id], stage, message),
  );
}
export async function transition(
  id: string,
  status: StoredJob["status"],
  stage: string,
  progress: number,
  message: string,
) {
  return workspace.update((state) => {
    const job = state.jobs[id];
    if (job.cancel_requested) return;
    Object.assign(job, {
      status,
      stage,
      progress,
      updated_at: new Date().toISOString(),
      next_run_at: Date.now(),
    });
    appendEvent(job, stage, message);
  });
}
export function finishPreparation(
  job: Pick<StoredJob, "id" | "config">,
  reviewMessage: string,
) {
  if (job.config.reviewBeforeGeneration)
    return transition(job.id, "awaiting_approval", "review", 45, reviewMessage);
  return transition(
    job.id,
    "queued",
    "registering",
    45,
    "Prepared references are ready. Continuing to video generation.",
  );
}
export async function approveJob(id: string) {
  const job = await workspace.update((state) => {
    const job = state.jobs[id];
    if (!job) throw new AppError(404, "NOT_FOUND", "Take not found.");
    if (
      job.status !== "awaiting_approval" ||
      !job.masked_id ||
      (job.config.prepareImage && !job.anchor_id) ||
      job.cancel_requested
    )
      throw new AppError(
        409,
        "NOT_AWAITING_APPROVAL",
        "This take is not waiting for reference approval.",
      );
    Object.assign(job, {
      status: "queued",
      stage: "registering",
      next_run_at: Date.now(),
      updated_at: new Date().toISOString(),
    });
    appendEvent(
      job,
      "registering",
      "Prepared references approved. Continuing to video generation.",
    );
    return job;
  });
  return presentJob(job);
}
export async function cancelJob(id: string) {
  const job = await workspace.update((state) => {
    const job = state.jobs[id];
    if (!job) throw new AppError(404, "NOT_FOUND", "Take not found.");
    if (finished(job.status))
      throw new AppError(
        409,
        "TERMINAL_JOB",
        "This take has already finished.",
      );
    job.cancel_requested = true;
    // Review is not runnable, even if its previous worker is still releasing
    // the lease. It must finish here rather than wait for another claim.
    if (
      job.status === "awaiting_approval" ||
      (job.status === "queued" && !job.lease_owner)
    ) {
      job.status = "cancelled";
      job.stage = "cancelled";
    }
    job.updated_at = new Date().toISOString();
    job.next_run_at = Date.now();
    appendEvent(
      job,
      "cancelled",
      "Cancellation requested. A generation already running at the provider may still finish.",
    );
    return job;
  });
  return presentJob(job);
}
export async function claimJob(worker: string) {
  return workspace.update((state) => {
    const now = Date.now();
    const job = Object.values(state.jobs)
      .filter(
        (job) =>
          runnable(job.status) &&
          job.next_run_at <= now &&
          (!job.lease_until || job.lease_until < now),
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    if (!job) return null;
    job.lease_owner = worker;
    job.lease_until = now + 180000;
    job.attempts++;
    return job.id;
  });
}
export async function renewLease(id: string, worker: string) {
  return workspace.update((state) => {
    const job = state.jobs[id];
    if (!job || job.lease_owner !== worker) return false;
    job.lease_until = Date.now() + 180000;
    return !job.cancel_requested;
  });
}
