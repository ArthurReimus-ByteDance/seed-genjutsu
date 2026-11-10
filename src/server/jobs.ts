import { randomUUID } from "node:crypto";
import { workspace, type StoredJob, type StoredMedia } from "./workspace";
import { publicUpload } from "./storage";
import { AppError } from "./http";
import { env } from "@/env";
import { createJobSchema, type CreateJob, type Job } from "@/lib/schemas";
import { effectiveDirection, registrationMediaId } from "@/lib/workflows";
import { providerModelId } from "./video-models";
import {
  maskReviewReasons,
  resolveMaskReview,
  samRefinementReasons,
  usableSamRefinement,
  type SamRefinement,
  type SamVerification,
} from "@/lib/sam-verification";
import {
  validateSourceVideo,
  validateReferenceImage,
  validateReferenceVideo,
} from "./reference-media";
const runnable = (status: string) =>
  ["queued", "processing", "generating"].includes(status);
const finished = (status: string) =>
  ["succeeded", "failed", "cancelled", "needs_attention"].includes(status);

export function hasUsableSamRefinement(job: StoredJob) {
  const refinement = job.sam_refinement;
  return (
    !!refinement &&
    usableSamRefinement(refinement) &&
    refinement.model === job.sam_verifier_model_id &&
    refinement.preparedId === job.prepared_id &&
    refinement.originalTarget === job.config.target &&
    ((job.sam_attempt ?? 0) > 0 || refinement.description === job.sam_target)
  );
}

function requiredMedia(media: Record<string, StoredMedia>, id: string | null) {
  if (!id || !media[id])
    throw new AppError(
      404,
      "NOT_FOUND",
      "A required media reference is missing.",
    );
  return media[id];
}
function resolveInputs(media: Record<string, StoredMedia>, config: CreateJob) {
  const source = requiredMedia(media, config.sourceId);
  validateSourceVideo(source, config.start, config.duration);
  const character = config.characterId
    ? requiredMedia(media, config.characterId)
    : null;
  if (character) validateReferenceImage(character, "character");
  const references = config.references.map((reference) => {
    const image = requiredMedia(media, reference.mediaId);
    validateReferenceImage(image, "character");
    return { id: reference.id, role: reference.role, media: image };
  });
  return { source, character, references };
}
function reviewMedia(
  media: Record<string, StoredMedia>,
  job: StoredJob,
  requireAnchor = true,
) {
  if (
    job.config.workflow === "character_swap" &&
    job.sam_refinement_required &&
    !hasUsableSamRefinement(job)
  )
    throw new AppError(
      409,
      "SUBJECT_NOT_REFINED",
      "The source subject has not passed AI prompt refinement.",
    );
  if (job.config.workflow === "character_swap" && job.sam_refinement_required)
    validateReferenceVideo(
      requiredMedia(media, job.prepared_id),
      "prepared",
      job.config.duration,
    );
  if (job.config.workflow === "character_swap" && job.sam_verifier_model_id) {
    const verification = job.sam_verifications?.at(-1);
    if (
      !verification ||
      verification.maskedId !== job.masked_id ||
      verification.model !== job.sam_verifier_model_id ||
      verification.attempt !== (job.sam_attempt ?? 0) + 1 ||
      verification.target !== (job.sam_target ?? job.config.target) ||
      resolveMaskReview(
        verification,
        verification.analysis,
        verification.target,
        verification.attempt - 1,
      ) !== "pass"
    )
      throw new AppError(
        409,
        "MASK_NOT_VERIFIED",
        "The subject mask has not passed AI verification.",
      );
  }
  const registration = requiredMedia(media, registrationMediaId(job));
  const kind = job.config.workflow === "character_swap" ? "masked" : "prepared";
  validateReferenceVideo(registration, kind, job.config.duration);
  const anchor = job.anchor_id ? requiredMedia(media, job.anchor_id) : null;
  if (requireAnchor && job.config.prepareImage && !anchor)
    throw new AppError(
      400,
      "MISSING_ANCHOR",
      "The prepared scene image is missing.",
    );
  if (anchor) validateReferenceImage(anchor, "anchor");
  return { registration, anchor };
}
export async function validateSubmission(id: string, requireAnchor = true) {
  return workspace.read((state) => {
    const job = state.jobs[id];
    if (!job) throw new AppError(404, "NOT_FOUND", "Take not found.");
    const config = createJobSchema.parse(job.config);
    if (
      job.source_id !== config.sourceId ||
      job.character_id !== (config.characterId ?? null)
    )
      throw new AppError(
        400,
        "INVALID_INPUT",
        "The saved media references do not match this take.",
      );
    const inputs = resolveInputs(state.media, config);
    const { registration, anchor } = reviewMedia(
      state.media,
      job,
      requireAnchor,
    );
    const images =
      inputs.references.length +
      (inputs.character ? 1 : 0) +
      (anchor && config.workflow === "character_swap" ? 1 : 0);
    if (images > (config.model === "seedance-2.5" ? 30 : 9))
      throw new AppError(
        400,
        "REFERENCE_LIMIT",
        "Too many images for this model.",
      );
    return { ...inputs, registration, anchor };
  });
}
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
    if (!source || (row.config.workflow === "character_swap" && !character))
      throw new Error("A saved take is missing its references.");
    const references = row.config.references.map((reference) => {
      const media = get(reference.mediaId);
      if (!media) throw new Error("A saved take is missing its references.");
      return { id: reference.id, role: reference.role, media };
    });
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
      references,
      prepared: get(row.prepared_id),
      frame: get(row.frame_id),
      anchor: get(row.anchor_id),
      masked: get(row.masked_id),
      samRefinement: row.sam_refinement ?? null,
      maskVerifications: row.sam_verifications ?? [],
      maskComparison: get(
        row.mask_comparison_id ??
          row.sam_verifications?.at(-1)?.comparisonId ??
          null,
      ),
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
  input = createJobSchema.parse(input);
  if (input.prepareImage && !env.SEEDREAM_MODEL)
    throw new AppError(
      503,
      "IMAGE_SETUP",
      "The Seedream image model is not connected yet. Disable scene preparation or configure its verified model ID.",
    );
  const job = await workspace.update((state) => {
    const { source, character } = resolveInputs(state.media, input);
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
      name: effectiveDirection(input).slice(0, 60),
      prompt: input.prompt,
      config: input,
      source_id: source.id,
      character_id: character?.id ?? null,
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
      ...(input.workflow === "character_swap"
        ? {
            sam_attempt: 0,
            sam_refinement_required: true,
            sam_verifier_model_id: env.SAM_VERIFIER_MODEL,
            sam_verifications: [],
          }
        : {}),
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
export async function completeSamRefinement(
  id: string,
  worker: string,
  refinement: SamRefinement,
) {
  return workspace.update((state) => {
    const job = state.jobs[id];
    if (
      !job ||
      job.lease_owner !== worker ||
      !job.lease_until ||
      job.lease_until <= Date.now()
    )
      throw new AppError(
        409,
        "LEASE_ENDED",
        "This worker no longer owns the take.",
      );
    if (
      job.config.workflow !== "character_swap" ||
      job.stage !== "prompt_refinement" ||
      !job.sam_refinement_required ||
      (job.sam_attempt ?? 0) !== 0 ||
      refinement.model !== job.sam_verifier_model_id ||
      refinement.preparedId !== job.prepared_id ||
      refinement.originalTarget !== job.config.target ||
      job.meta_response_id ||
      job.sam_request_id ||
      job.masked_id ||
      job.asset_id ||
      job.provider_task_id ||
      job.submission_started_at
    )
      throw new AppError(
        409,
        "INVALID_STAGE",
        "The take has moved past source-subject refinement.",
      );
    job.sam_refinement = refinement;
    job.updated_at = new Date().toISOString();
    if (job.cancel_requested || finished(job.status)) return;
    if (!usableSamRefinement(refinement)) {
      job.status = "needs_attention";
      job.error =
        samRefinementReasons[refinement.reason] +
        " Clarify the source-subject description and start a new take. SAM was not submitted.";
      appendEvent(job, "prompt_refinement", job.error);
      return;
    }
    Object.assign(job, {
      sam_target: refinement.description!,
      status: "processing",
      stage: "masking",
      progress: 15,
      next_run_at: Date.now(),
    });
    appendEvent(
      job,
      "masking",
      "AI source-subject refinement prepared the SAM description: " +
        JSON.stringify(job.sam_target),
    );
  });
}
export async function completeSamVerification(
  id: string,
  worker: string,
  verification: SamVerification,
) {
  return workspace.update((state) => {
    const job = state.jobs[id];
    if (
      !job ||
      job.lease_owner !== worker ||
      !job.lease_until ||
      job.lease_until <= Date.now()
    )
      throw new AppError(
        409,
        "LEASE_ENDED",
        "This worker no longer owns the take.",
      );
    if (
      job.config.workflow !== "character_swap" ||
      job.stage !== "mask_verification" ||
      verification.attempt !== (job.sam_attempt ?? 0) + 1 ||
      verification.model !== job.sam_verifier_model_id ||
      verification.maskedId !== job.masked_id ||
      verification.target !== (job.sam_target ?? job.config.target) ||
      job.asset_id ||
      job.provider_task_id ||
      job.submission_started_at
    )
      throw new AppError(
        409,
        "INVALID_STAGE",
        "The take has moved past this mask verification attempt.",
      );
    job.sam_verifications = [
      ...(job.sam_verifications ?? []).filter(
        (review) => review.attempt !== verification.attempt,
      ),
      verification,
    ];
    job.mask_comparison_id = verification.comparisonId;
    job.updated_at = new Date().toISOString();
    if (job.cancel_requested || finished(job.status)) return;
    const action = resolveMaskReview(
      verification,
      verification.analysis,
      verification.target,
      verification.attempt - 1,
    );
    if (action === "retry") {
      Object.assign(job, {
        sam_attempt: 1,
        sam_target: verification.description!.trim(),
        masked_id: null,
        meta_response_id: null,
        status: "processing",
        stage: "masking",
        progress: 15,
        next_run_at: Date.now(),
      });
      appendEvent(
        job,
        "masking",
        "AI verification requested one SAM correction using: " +
          JSON.stringify(job.sam_target),
      );
    } else if (action === "pass") {
      Object.assign(job, {
        status: job.config.prepareImage
          ? "processing"
          : job.config.reviewBeforeGeneration
            ? "awaiting_approval"
            : "queued",
        stage: job.config.prepareImage
          ? "image_preparation"
          : job.config.reviewBeforeGeneration
            ? "review"
            : "registering",
        progress: job.config.prepareImage ? 35 : 45,
        next_run_at: Date.now(),
      });
      appendEvent(
        job,
        job.stage,
        "AI mask verification passed. " +
          (job.config.prepareImage
            ? "Preparing the character in your scene."
            : job.config.reviewBeforeGeneration
              ? "Review the masked performance before generation."
              : "Continuing to Virtual Portrait registration."),
      );
    } else {
      job.status = "needs_attention";
      job.error =
        maskReviewReasons[verification.reason] +
        (verification.attempt === 2
          ? " The automatic SAM correction limit was reached."
          : "") +
        " Review the comparison and edit the subject description to start a new take.";
      appendEvent(job, "mask_verification", job.error);
    }
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
  worker?: string,
) {
  return workspace.update((state) => {
    const job = state.jobs[id];
    if (!job) throw new AppError(404, "NOT_FOUND", "Take not found.");
    if (
      worker &&
      (job.lease_owner !== worker ||
        !job.lease_until ||
        job.lease_until <= Date.now())
    )
      throw new AppError(
        409,
        "LEASE_ENDED",
        "This worker no longer owns the take.",
      );
    if (job.cancel_requested || finished(job.status)) return;
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
export async function completeProviderStage(
  id: string,
  worker: string,
  result: { kind: "asset" | "task" | "result"; id: string },
) {
  return workspace.update((state) => {
    const job = state.jobs[id];
    if (!job) throw new AppError(404, "NOT_FOUND", "Take not found.");
    if (
      job.lease_owner !== worker ||
      !job.lease_until ||
      job.lease_until <= Date.now()
    )
      throw new AppError(
        409,
        "LEASE_ENDED",
        "This worker no longer owns the take.",
      );
    const completion = {
      asset: {
        field: "asset_id",
        previous: "registering",
        stage: "asset_review",
        status: "processing",
        progress: 55,
        message: "Reference uploaded. Waiting for Virtual Portrait processing.",
      },
      task: {
        field: "provider_task_id",
        previous: "submitting",
        stage: "generating",
        status: "generating",
        progress: 75,
        message:
          "Your video task is submitted. Waiting for the transformation.",
      },
      result: {
        field: "result_id",
        previous: "generating",
        stage: "complete",
        status: "succeeded",
        progress: 100,
        message: "Your video is ready to review and download.",
      },
    } as const;
    const next = completion[result.kind];
    if (job.stage !== next.previous && job.stage !== next.stage)
      throw new AppError(
        409,
        "INVALID_STAGE",
        "The take has moved to another stage.",
      );
    if (job[next.field] && job[next.field] !== result.id)
      throw new AppError(
        409,
        "PROVIDER_ID_CONFLICT",
        "The take already has a provider result.",
      );
    job[next.field] = result.id;
    job.submission_started_at = null;
    job.updated_at = new Date().toISOString();
    if (job.cancel_requested || job.stage === next.stage) return;
    Object.assign(job, {
      status: next.status,
      stage: next.stage,
      progress: next.progress,
      next_run_at: Date.now(),
    });
    appendEvent(job, next.stage, next.message);
  });
}
export function finishPreparation(
  job: Pick<StoredJob, "id" | "config">,
  reviewMessage: string,
  worker?: string,
) {
  if (job.config.reviewBeforeGeneration)
    return transition(
      job.id,
      "awaiting_approval",
      "review",
      45,
      reviewMessage,
      worker,
    );
  return transition(
    job.id,
    "queued",
    "registering",
    45,
    "Prepared references are ready. Continuing to video generation.",
    worker,
  );
}
export async function approveJob(id: string) {
  const job = await workspace.update((state) => {
    const job = state.jobs[id];
    if (!job) throw new AppError(404, "NOT_FOUND", "Take not found.");
    if (job.status !== "awaiting_approval" || job.cancel_requested)
      throw new AppError(
        409,
        "NOT_AWAITING_APPROVAL",
        "This take is not waiting for reference approval.",
      );
    try {
      resolveInputs(state.media, job.config);
      reviewMedia(state.media, job);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      throw new AppError(
        409,
        "NOT_AWAITING_APPROVAL",
        "This take has missing or invalid prepared references.",
      );
    }
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
    if (
      !job ||
      job.lease_owner !== worker ||
      !job.lease_until ||
      job.lease_until <= Date.now()
    )
      return false;
    job.lease_until = Date.now() + 180000;
    return !job.cancel_requested;
  });
}
