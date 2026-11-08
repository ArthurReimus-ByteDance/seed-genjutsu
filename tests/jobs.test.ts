import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createJobSchema } from "../src/lib/schemas";

const root = await mkdtemp(path.join(tmpdir(), "recast-job-test-"));
process.env.MEDIA_ROOT = root;
process.env.STORAGE_MODE = "local";
const { saveMedia } = await import("../src/server/storage");
const {
  createJob,
  claimJob,
  finishPreparation,
  cancelJob,
  updateJob,
  jobRecord,
} = await import("../src/server/jobs");
after(() => rm(root, { recursive: true, force: true }));

async function createTestTake(reviewBeforeGeneration?: boolean) {
  const common = { data: Buffer.from("fixture"), width: 320, height: 180 };
  const source = await saveMedia({
    ...common,
    kind: "video",
    name: "clip.mp4",
    mime: "video/mp4",
    duration: 4,
  });
  const character = await saveMedia({
    ...common,
    kind: "character",
    name: "character.jpg",
    mime: "image/jpeg",
  });
  return createJob(
    createJobSchema.parse({
      sourceId: source.id,
      characterId: character.id,
      prompt: "Preserve the original performance.",
      duration: 4,
      reviewBeforeGeneration,
    }),
  );
}

test("cancelling reference review finishes even before its worker releases the lease", async () => {
  const job = await createTestTake();
  assert.equal(await claimJob("review-worker"), job.id);
  await finishPreparation(await jobRecord(job.id), "References ready.");
  assert.equal((await jobRecord(job.id)).status, "awaiting_approval");
  const cancelled = await cancelJob(job.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.stage, "cancelled");
  // This is the worker's finally block after the review transition.
  await updateJob(job.id, { lease_owner: null, lease_until: null });
  assert.equal((await jobRecord(job.id)).status, "cancelled");
  assert.equal(await claimJob("another-worker"), null);
});

test("an automatic take can be claimed for registration after preparation", async () => {
  const job = await createTestTake(false);
  assert.equal(await claimJob("preparation-worker"), job.id);
  await finishPreparation(await jobRecord(job.id), "References ready.");
  await updateJob(job.id, { lease_owner: null, lease_until: null });
  assert.equal(await claimJob("registration-worker"), job.id);
  const saved = await jobRecord(job.id);
  assert.equal(saved.config.reviewBeforeGeneration, false);
  assert.equal(saved.stage, "registering");
});
