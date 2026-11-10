import type { Job, Upload } from "@/lib/schemas";
export type DemoRecord = {
  job: Job;
  scenario: "success" | "failure";
  approvedAt: string | null;
  prepared: Upload | null;
  masked: Upload | null;
  anchor: Upload | null;
  result: Upload;
};
export function advanceDemo(record: DemoRecord, now = Date.now()): DemoRecord {
  const { job } = record;
  if (
    [
      "succeeded",
      "failed",
      "cancelled",
      "needs_attention",
      "awaiting_approval",
    ].includes(job.status)
  )
    return record;
  const characterSwap =
    (job.config.workflow ?? "character_swap") === "character_swap";
  const createdAt = Date.parse(job.createdAt);
  const readyAt = createdAt + 6500;
  let generationStartedAt = record.approvedAt
    ? Date.parse(record.approvedAt)
    : null;
  if (!job.config.reviewBeforeGeneration && now >= readyAt)
    generationStartedAt ??= readyAt;
  const elapsed = now - (generationStartedAt ?? createdAt);
  let stage = job.stage,
    status = job.status,
    progress = job.progress,
    message = "";
  if (generationStartedAt === null) {
    if (now >= readyAt) {
      stage = "review";
      status = "awaiting_approval";
      progress = 45;
      message = characterSwap
        ? "Your sample references are ready for review."
        : "Your original prepared clip is ready for review. Generation is simulated.";
    } else if (characterSwap && elapsed >= 4750 && job.config.prepareImage) {
      stage = "image_preparation";
      status = "processing";
      progress = 35;
      message = "Preparing the scene look (simulated).";
    } else if (characterSwap && elapsed >= 3500) {
      stage = "mask_verification";
      status = "processing";
      progress = 30;
      message =
        "AI video mask verification (simulated). No VLM inference or mask-quality assessment is performed.";
    } else if (elapsed >= 1500) {
      stage = characterSwap ? "masking" : "trimming";
      status = "processing";
      progress = 20;
      message = characterSwap
        ? "Tracking the subject (simulated)."
        : "Trimming and normalizing the original clip. SAM masking is skipped.";
    } else if (characterSwap && elapsed >= 750) {
      stage = "prompt_refinement";
      status = "processing";
      progress = 10;
      message =
        "AI source-subject prompt refinement (simulated). No DeepSeek inference or subject identification is performed.";
    }
  } else {
    if (elapsed >= 10000) {
      if (record.scenario === "failure") {
        stage = "generating";
        status = "failed";
        progress = 75;
        message =
          "The sample provider could not finish this simulated take. Your inputs are saved. Try a new take to continue.";
      } else {
        stage = "complete";
        status = "succeeded";
        progress = 100;
        message =
          "Your simulated prerecorded result is ready. This fixed sample does not demonstrate the requested edit or model output quality.";
      }
    } else if (elapsed >= 4500) {
      stage = "generating";
      status = "generating";
      progress = 78;
      message = "Creating the video (simulated).";
    } else if (elapsed >= 2000) {
      stage = "asset_review";
      status = "processing";
      progress = 60;
      message =
        "Checking Virtual Portrait video eligibility (simulated). Active status does not verify real-person authorization or media rights. This preview provides no model-quality evidence.";
    } else {
      stage = "registering";
      status = "processing";
      progress = 50;
      message = "Registering your reference (simulated).";
    }
  }
  if (stage === job.stage && status === job.status) return record;
  const updatedAt = new Date(now).toISOString();
  const referencesReady =
    status === "awaiting_approval" || generationStartedAt !== null;
  return {
    ...record,
    job: {
      ...job,
      stage,
      status,
      progress,
      updatedAt,
      prepared:
        !characterSwap && referencesReady ? record.prepared : job.prepared,
      masked: characterSwap && referencesReady ? record.masked : job.masked,
      anchor:
        characterSwap && job.config.prepareImage && referencesReady
          ? record.anchor
          : job.anchor,
      result: status === "succeeded" ? record.result : null,
      error: status === "failed" ? message : null,
      events: [
        ...job.events,
        { id: job.events.length + 1, stage, message, createdAt: updatedAt },
      ],
    },
  };
}
