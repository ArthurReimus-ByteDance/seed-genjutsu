import type { Job, Upload } from "@/lib/schemas";
export type DemoRecord = {
  job: Job;
  scenario: "success" | "failure";
  approvedAt: string | null;
  masked: Upload;
  anchor: Upload;
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
      message = "Your sample references are ready for review.";
    } else if (elapsed >= 3500 && job.config.prepareImage) {
      stage = "image_preparation";
      status = "processing";
      progress = 35;
      message = "Preparing the scene look (simulated).";
    } else if (elapsed >= 1500) {
      stage = "masking";
      status = "processing";
      progress = 20;
      message = "Tracking the subject (simulated).";
    }
  } else {
    if (elapsed >= 10000) {
      if (record.scenario === "failure") {
        stage = "generating";
        status = "failed";
        progress = 75;
        message =
          "The sample provider could not finish this take. Your inputs are saved. Try a new take to continue.";
      } else {
        stage = "complete";
        status = "succeeded";
        progress = 100;
        message =
          "Your simulated result is ready. Compare it with the original and download the sample.";
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
      message = "Checking the video reference (simulated).";
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
      masked: referencesReady ? record.masked : job.masked,
      anchor:
        job.config.prepareImage && referencesReady ? record.anchor : job.anchor,
      result: status === "succeeded" ? record.result : null,
      error: status === "failed" ? message : null,
      events: [
        ...job.events,
        { id: job.events.length + 1, stage, message, createdAt: updatedAt },
      ],
    },
  };
}
