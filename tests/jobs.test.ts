import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createJobSchema, jobSchema, type CreateJob } from "../src/lib/schemas";
import {
  refinementFixture,
  verificationFixture,
} from "../scripts/fixtures/meta-sam";

const root = await mkdtemp(path.join(tmpdir(), "recast-job-test-"));
process.env.MEDIA_ROOT = root;
process.env.STORAGE_MODE = "local";
const { saveMedia } = await import("../src/server/storage");
const { workspace } = await import("../src/server/workspace");
const {
  createJob,
  claimJob,
  finishPreparation,
  cancelJob,
  updateJob,
  jobRecord,
  completeProviderStage,
  approveJob,
  presentJob,
  validateSubmission,
  renewLease,
  completeSamVerification,
  completeSamRefinement,
} = await import("../src/server/jobs");
after(() => rm(root, { recursive: true, force: true }));
beforeEach(() =>
  workspace.update((state) => {
    state.jobs = {};
    state.media = {};
  }),
);

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
    width: 600,
    height: 600,
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

async function transformationInput(
  workflow: CreateJob["workflow"] = "restyle",
) {
  const source = await saveMedia({
    data: Buffer.from("source"),
    width: 320,
    height: 180,
    kind: "video",
    name: "source.mp4",
    mime: "video/mp4",
    duration: 8,
  });
  return createJobSchema.parse({
    sourceId: source.id,
    workflow,
    model: "seedance-2.5",
    duration: 4,
    prompt: workflow === "restyle" ? "" : "Change the jacket to red.",
    stylePreset: workflow === "restyle" ? "watercolor" : "custom",
  });
}

async function preparedMedia(
  kind: "prepared" | "masked" | "anchor" = "prepared",
) {
  return saveMedia({
    data: Buffer.from("prepared"),
    width: 1280,
    height: 720,
    kind,
    name: "Prepared reference",
    mime: kind === "anchor" ? "image/jpeg" : "video/mp4",
    duration: kind === "anchor" ? null : 4,
  });
}

test("video-only workflows persist nullable characters and resolve prepared review media", async () => {
  for (const workflow of ["element_edit", "restyle"] as const) {
    const job = await createJob(await transformationInput(workflow));
    assert.equal(job.character, null);
    assert.deepEqual(job.references, []);
    assert.equal(job.prepared, null);
    assert.ok(job.name.length >= 10);
    const prepared = await preparedMedia();
    await updateJob(job.id, { prepared_id: prepared.id });
    await finishPreparation(await jobRecord(job.id), "Original clip ready.");
    const approved = await approveJob(job.id);
    assert.equal(approved.stage, "registering");
    assert.equal(approved.prepared?.id, prepared.id);
    assert.equal(approved.masked, null);
    assert.equal(jobSchema.safeParse(approved).success, true);
    await cancelJob(job.id);
  }
});

test("ordered references retain their IDs roles and media without requiring a character", async () => {
  const input = await transformationInput("element_edit");
  const references: CreateJob["references"] = [];
  for (const role of ["scene", "character"] as const) {
    const media = await saveMedia({
      data: Buffer.from(role),
      width: 600,
      height: 600,
      kind: "character",
      name: role,
      mime: "image/jpeg",
    });
    references.push({ id: randomUUID(), role, mediaId: media.id });
  }
  const job = await createJob({
    ...input,
    workflow: "motion_transfer",
    references,
  });
  assert.equal(job.character, null);
  assert.deepEqual(
    job.references.map(({ id, role, media }) => ({
      id,
      role,
      mediaId: media.id,
    })),
    references,
  );
  assert.equal((await jobRecord(job.id)).character_id, null);
  await workspace.update((state) => {
    delete state.media[references[0].mediaId];
  });
  await assert.rejects(presentJob(await jobRecord(job.id)), /missing/i);
});

test("approval validates the workflow-selected media kind and existence rather than any video ID", async () => {
  const job = await createJob(await transformationInput());
  const masked = await preparedMedia("masked");
  await updateJob(job.id, { prepared_id: masked.id, masked_id: masked.id });
  await finishPreparation(await jobRecord(job.id), "Review.");
  await assert.rejects(
    approveJob(job.id),
    (error: unknown) =>
      (error as { code: string }).code === "NOT_AWAITING_APPROVAL",
  );
  await updateJob(job.id, { prepared_id: randomUUID() });
  await assert.rejects(approveJob(job.id));
  const prepared = await preparedMedia();
  await updateJob(job.id, { prepared_id: prepared.id });
  assert.equal((await approveJob(job.id)).stage, "registering");
  await assert.rejects(approveJob(job.id));
});

test("approval rejects missing images and invalid prepared metadata without advancing the take", async () => {
  const input = await transformationInput("element_edit");
  const image = await saveMedia({
    data: Buffer.from("image"),
    width: 600,
    height: 600,
    kind: "character",
    name: "Jacket",
    mime: "image/jpeg",
  });
  const job = await createJob({
    ...input,
    references: [{ id: randomUUID(), mediaId: image.id, role: "garment" }],
  });
  const prepared = await preparedMedia();
  await updateJob(job.id, { prepared_id: prepared.id });
  await finishPreparation(await jobRecord(job.id), "Review.");
  await workspace.update((state) => {
    state.media[prepared.id].width = 0;
  });
  await assert.rejects(approveJob(job.id));
  assert.equal((await jobRecord(job.id)).status, "awaiting_approval");
  await workspace.update((state) => {
    state.media[prepared.id].width = 1280;
    delete state.media[image.id];
  });
  await assert.rejects(approveJob(job.id));
  assert.equal((await jobRecord(job.id)).status, "awaiting_approval");
});

test("swaps still require the actual masked video and their optional prepared anchor", async () => {
  const job = await createTestTake();
  const prepared = await preparedMedia();
  await updateJob(job.id, { prepared_id: prepared.id, masked_id: prepared.id });
  await finishPreparation(await jobRecord(job.id), "Review.");
  await assert.rejects(approveJob(job.id));
  const masked = await preparedMedia("masked");
  await updateJob(job.id, {
    masked_id: masked.id,
    sam_target: job.config.target,
    sam_refinement: refinementFixture(prepared.id),
    sam_verifications: [verificationFixture(masked.id, prepared.id)],
    config: { ...job.config, prepareImage: true },
  });
  await assert.rejects(approveJob(job.id));
  await updateJob(job.id, { anchor_id: job.character!.id });
  await assert.rejects(approveJob(job.id));
  const anchor = await preparedMedia("anchor");
  await updateJob(job.id, { anchor_id: anchor.id });
  assert.equal((await approveJob(job.id)).stage, "registering");
});

test("new swaps cannot approve or submit an unverified or replaced mask", async () => {
  const job = await createTestTake();
  const prepared = await preparedMedia();
  const masked = await preparedMedia("masked");
  await updateJob(job.id, {
    prepared_id: prepared.id,
    sam_target: job.config.target,
    sam_refinement: refinementFixture(prepared.id),
    masked_id: masked.id,
    status: "awaiting_approval",
    stage: "review",
  });
  await assert.rejects(approveJob(job.id));
  await assert.rejects(
    validateSubmission(job.id),
    /not passed AI verification/,
  );
  await updateJob(job.id, {
    sam_verifications: [verificationFixture(masked.id, randomUUID())],
  });
  assert.equal((await validateSubmission(job.id)).registration.id, masked.id);
  const replacement = await preparedMedia("masked");
  await updateJob(job.id, { masked_id: replacement.id });
  await assert.rejects(
    validateSubmission(job.id),
    /not passed AI verification/,
  );
});

test("verification retry commits one correction atomically and preserves the original subject", async () => {
  const job = await createTestTake();
  const masked = await preparedMedia("masked");
  await claimJob("verifier-worker");
  await updateJob(job.id, { stage: "mask_verification", masked_id: masked.id });
  const verification = {
    ...verificationFixture(masked.id, randomUUID()),
    decision: "retry" as const,
    reason: "wrong_subject" as const,
    description: "person in a black sleeveless shirt",
  };
  const outcomes = await Promise.allSettled([
    completeSamVerification(job.id, "verifier-worker", verification),
    completeSamVerification(job.id, "verifier-worker", verification),
  ]);
  assert.equal(
    outcomes.filter((outcome) => outcome.status === "fulfilled").length,
    1,
  );
  const saved = await jobRecord(job.id);
  assert.equal(saved.stage, "masking");
  assert.equal(saved.sam_attempt, 1);
  assert.equal(saved.sam_target, verification.description);
  assert.equal(saved.config.target, "person");
  assert.equal(saved.masked_id, null);
  assert.equal(saved.sam_verifications?.length, 1);
});

test("source refinement commits once with original intent and exposes a separate public report", async () => {
  const job = await createTestTake();
  const prepared = await preparedMedia();
  await claimJob("refinement-worker");
  await updateJob(job.id, {
    stage: "prompt_refinement",
    prepared_id: prepared.id,
  });
  const refinement = refinementFixture(
    prepared.id,
    "person",
    "person wearing black",
  );
  const outcomes = await Promise.allSettled([
    completeSamRefinement(job.id, "refinement-worker", refinement),
    completeSamRefinement(job.id, "refinement-worker", refinement),
  ]);
  assert.equal(
    outcomes.filter((outcome) => outcome.status === "fulfilled").length,
    1,
  );
  const saved = await jobRecord(job.id);
  assert.equal(saved.config.target, "person");
  assert.equal(saved.sam_target, "person wearing black");
  assert.equal(saved.stage, "masking");
  assert.equal(saved.sam_attempt, 0);
  assert.deepEqual((await presentJob(saved)).samRefinement, refinement);
});

test("approval binds source refinement to the current clip model and original description", async () => {
  const job = await createTestTake();
  const prepared = await preparedMedia();
  const masked = await preparedMedia("masked");
  const refinement = refinementFixture(prepared.id);
  await updateJob(job.id, {
    stage: "review",
    status: "awaiting_approval",
    prepared_id: prepared.id,
    masked_id: masked.id,
    sam_target: "person",
    sam_verifications: [verificationFixture(masked.id, randomUUID())],
  });
  await assert.rejects(approveJob(job.id));
  for (const report of [
    { ...refinement, preparedId: randomUUID() },
    { ...refinement, model: "different-model" },
    { ...refinement, originalTarget: "someone else" },
    { ...refinement, description: "different subject" },
    { ...refinement, decision: "needs_review" as const, description: null },
  ]) {
    await updateJob(job.id, { sam_refinement: report });
    await assert.rejects(validateSubmission(job.id), /prompt refinement/);
  }
  await updateJob(job.id, { sam_refinement: refinement });
  assert.equal((await approveJob(job.id)).stage, "registering");
});

test("ambiguous refinement and cancelled or expired leases cannot start masking", async () => {
  for (const state of [
    "ambiguous",
    "cancelled",
    "expired",
    "wrong-clip",
  ] as const) {
    const job = await createTestTake(false);
    const prepared = await preparedMedia();
    await claimJob("refinement-worker");
    await updateJob(job.id, {
      stage: "prompt_refinement",
      prepared_id: prepared.id,
      cancel_requested: state === "cancelled",
      lease_until: state === "expired" ? Date.now() - 1 : Date.now() + 60000,
    });
    const refinement = refinementFixture(prepared.id);
    if (state === "ambiguous") {
      refinement.decision = "needs_review";
      refinement.reason = "ambiguous_subject";
      refinement.description = null;
    }
    if (state === "wrong-clip") refinement.preparedId = randomUUID();
    if (state === "expired" || state === "wrong-clip")
      await assert.rejects(
        completeSamRefinement(job.id, "refinement-worker", refinement),
      );
    else await completeSamRefinement(job.id, "refinement-worker", refinement);
    const saved = await jobRecord(job.id);
    assert.equal(saved.stage, "prompt_refinement");
    assert.equal(saved.sam_target, undefined);
    assert.equal(saved.meta_response_id, null);
    if (state === "ambiguous") assert.equal(saved.status, "needs_attention");
    await updateJob(job.id, {
      status: "cancelled",
      lease_owner: null,
      lease_until: null,
    });
  }
});

test("uncertain verification blocks optional scene preparation and automatic generation", async () => {
  const job = await createTestTake(false);
  const masked = await preparedMedia("masked");
  await claimJob("verifier-worker");
  await updateJob(job.id, {
    stage: "mask_verification",
    masked_id: masked.id,
    config: { ...job.config, prepareImage: true },
  });
  await completeSamVerification(job.id, "verifier-worker", {
    ...verificationFixture(masked.id, randomUUID()),
    decision: "needs_review",
    reason: "uncertain",
    subjectIdentified: false,
  });
  const saved = await jobRecord(job.id);
  assert.equal(saved.status, "needs_attention");
  assert.equal(saved.stage, "mask_verification");
  assert.equal(saved.anchor_id, null);
  assert.equal(saved.asset_id, null);
  await assert.rejects(approveJob(job.id));
});

test("cancelled or expired workers cannot advance a take after vision review", async () => {
  const job = await createTestTake();
  const masked = await preparedMedia("masked");
  await claimJob("verifier-worker");
  await updateJob(job.id, {
    stage: "mask_verification",
    masked_id: masked.id,
    lease_until: Date.now() - 1,
  });
  const verification = verificationFixture(masked.id, randomUUID());
  await assert.rejects(
    completeSamVerification(job.id, "verifier-worker", verification),
    /owns the take/,
  );
  await updateJob(job.id, {
    lease_until: Date.now() + 60000,
    cancel_requested: true,
  });
  await completeSamVerification(job.id, "verifier-worker", verification);
  const saved = await jobRecord(job.id);
  assert.equal(saved.stage, "mask_verification");
  assert.equal(saved.cancel_requested, true);
  assert.equal(saved.sam_verifications?.length, 1);
});

test("creation rejects missing wrong-kind and unsupported reference images before queueing", async () => {
  const input = await transformationInput("element_edit");
  const reference = {
    id: randomUUID(),
    role: "object" as const,
    mediaId: randomUUID(),
  };
  await assert.rejects(createJob({ ...input, references: [reference] }));
  await assert.rejects(
    createJob({
      ...input,
      references: [{ ...reference, mediaId: input.sourceId }],
    }),
  );
  const image = await saveMedia({
    data: Buffer.from("image"),
    width: 600,
    height: 600,
    kind: "character",
    name: "reference",
    mime: "image/jpeg",
  });
  for (const patch of [
    { width: 299 },
    { width: 6001 },
    { width: 300, height: 1000 },
    { bytes: 30 * 1024 * 1024 },
    { bytes: 0 },
    { mime: "video/mp4" },
    { duration: 4 },
  ]) {
    await workspace.update((state) => {
      state.media[image.id] = { ...image, ...patch };
    });
    await assert.rejects(
      createJob({
        ...input,
        references: [{ ...reference, mediaId: image.id }],
      }),
    );
  }
  assert.equal(
    await workspace.read((state) => Object.keys(state.jobs).length),
    0,
  );
});

test("creation accepts the 30-image boundary and rejects duplicate or invalid direct-call configurations", async () => {
  const input = await transformationInput("element_edit");
  const references: CreateJob["references"] = [];
  for (let index = 0; index < 30; index++) {
    const media = await saveMedia({
      data: Buffer.from("image"),
      width: 300,
      height: 750,
      kind: "character",
      name: "reference",
      mime: "image/jpeg",
    });
    references.push({
      id: randomUUID(),
      role: "object" as const,
      mediaId: media.id,
    });
  }
  assert.equal(
    (await createJob({ ...input, references })).references.length,
    30,
  );
  await assert.rejects(
    createJob({ ...input, references: [references[0], references[0]] }),
  );
  await assert.rejects(createJob({ ...input, model: "seedance-2" }));
  await assert.rejects(createJob({ ...input, prepareImage: true }));
  await assert.rejects(createJob({ ...input, workflow: "motion_transfer" }));
  await assert.rejects(createJob({ ...input, prompt: "" }));
});

test("creation rejects unavailable source media unsupported geometry and trims beyond the source", async () => {
  const input = await transformationInput("element_edit");
  await assert.rejects(createJob({ ...input, sourceId: randomUUID() }));
  await assert.rejects(createJob({ ...input, start: 5 }));
  const source = await workspace.read((state) => state.media[input.sourceId]);
  for (const patch of [
    { kind: "prepared" as const },
    { mime: "image/jpeg" },
    { duration: null },
    { width: 0, height: 1000 },
    { width: 7000, height: 7000 },
    { bytes: 251 * 1024 * 1024 },
  ]) {
    await workspace.update((state) => {
      state.media[source.id] = { ...source, ...patch };
    });
    await assert.rejects(createJob(input));
  }
  assert.equal(
    await workspace.read((state) => Object.keys(state.jobs).length),
    0,
  );
});

test("submission revalidates prepared limits and missing references after approval", async () => {
  const job = await createJob(await transformationInput());
  const prepared = await preparedMedia();
  await updateJob(job.id, { prepared_id: prepared.id });
  await finishPreparation(await jobRecord(job.id), "Review.");
  await approveJob(job.id);
  for (const patch of [
    { width: 299 },
    { width: 6001 },
    { width: 300, height: 300 },
    { width: 6000, height: 6000 },
    { bytes: 200 * 1024 * 1024 + 1 },
    { duration: 3 },
    { duration: 30.1 },
    { mime: "image/jpeg" },
  ]) {
    await workspace.update((state) => {
      state.media[prepared.id] = { ...prepared, ...patch };
    });
    await assert.rejects(validateSubmission(job.id));
  }
  await workspace.update((state) => {
    state.media[prepared.id] = { ...prepared, bytes: 200 * 1024 * 1024 };
  });
  assert.equal((await validateSubmission(job.id)).registration.id, prepared.id);
  await workspace.update((state) => {
    delete state.media[job.source.id];
  });
  await assert.rejects(validateSubmission(job.id));
});

test("legacy workspace configs keep additive defaults and pinned provider IDs when reopened", async () => {
  const job = await createTestTake();
  await workspace.update((state) => {
    const config = state.jobs[job.id].config as Partial<CreateJob>;
    delete config.workflow;
    delete config.references;
    delete config.model;
    state.jobs[job.id].seedance_model_id = "original-pinned-endpoint";
  });
  const saved = await jobRecord(job.id);
  assert.equal(saved.config.workflow, "character_swap");
  assert.equal(saved.config.model, "seedance-2.5");
  assert.deepEqual(saved.config.references, []);
  assert.equal(saved.seedance_model_id, "original-pinned-endpoint");
  assert.equal((await presentJob(saved)).character?.id, job.character?.id);
});

test("expired workers cannot renew leases finish preparation or commit accepted IDs", async () => {
  const job = await createJob(await transformationInput());
  await claimJob("expired-worker");
  await updateJob(job.id, { stage: "submitting", lease_until: Date.now() - 1 });
  assert.equal(await renewLease(job.id, "expired-worker"), false);
  await assert.rejects(
    finishPreparation(await jobRecord(job.id), "Ready.", "expired-worker"),
    /owns the take/,
  );
  await assert.rejects(
    completeProviderStage(job.id, "expired-worker", {
      kind: "task",
      id: "accepted-task",
    }),
    /owns the take/,
  );
  assert.equal((await jobRecord(job.id)).stage, "submitting");
  assert.equal(await claimJob("replacement-worker"), job.id);
});

test("accepted provider completion is idempotent and rejects conflicting IDs", async () => {
  const job = await createJob(await transformationInput());
  await claimJob("provider-worker");
  await updateJob(job.id, { stage: "submitting" });
  await completeProviderStage(job.id, "provider-worker", {
    kind: "task",
    id: "accepted-task",
  });
  const saved = await jobRecord(job.id);
  await completeProviderStage(job.id, "provider-worker", {
    kind: "task",
    id: "accepted-task",
  });
  assert.equal((await jobRecord(job.id)).events.length, saved.events.length);
  await assert.rejects(
    completeProviderStage(job.id, "provider-worker", {
      kind: "task",
      id: "different-task",
    }),
    /already has a provider result/,
  );
  assert.equal((await jobRecord(job.id)).provider_task_id, "accepted-task");
});

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

test("accepted provider IDs, next stages and events are committed together", async () => {
  const job = await createTestTake();
  await claimJob("provider-worker");
  for (const [kind, stage, resultId, nextStage] of [
    ["asset", "registering", "fixture-asset", "asset_review"],
    ["task", "submitting", "fixture-task", "generating"],
    ["result", "generating", job.source.id, "complete"],
  ] as const) {
    await updateJob(job.id, {
      stage,
      submission_started_at: new Date().toISOString(),
    });
    await completeProviderStage(job.id, "provider-worker", {
      kind,
      id: resultId,
    });
    const saved = await jobRecord(job.id);
    assert.equal(saved.stage, nextStage);
    assert.equal(saved.submission_started_at, null);
    assert.equal(saved.events.at(-1)?.stage, nextStage);
    assert.equal(
      saved[
        kind === "asset"
          ? "asset_id"
          : kind === "task"
            ? "provider_task_id"
            : "result_id"
      ],
      resultId,
    );
  }
  assert.equal((await jobRecord(job.id)).status, "succeeded");
});

test("cancelled submissions retain accepted IDs without advancing or losing cancellation", async () => {
  const job = await createTestTake();
  await claimJob("cancel-worker");
  await updateJob(job.id, {
    status: "processing",
    stage: "submitting",
    submission_started_at: new Date().toISOString(),
  });
  await cancelJob(job.id);
  await completeProviderStage(job.id, "cancel-worker", {
    kind: "task",
    id: "fixture-cancel-task",
  });
  const saved = await jobRecord(job.id);
  assert.equal(saved.cancel_requested, true);
  assert.equal(saved.stage, "submitting");
  assert.equal(saved.provider_task_id, "fixture-cancel-task");
  assert.equal(saved.submission_started_at, null);
  await updateJob(job.id, {
    status: "cancelled",
    lease_owner: null,
    lease_until: null,
  });
});

test("a worker that lost its lease cannot commit a provider result", async () => {
  const job = await createTestTake();
  await claimJob("current-worker");
  await updateJob(job.id, { stage: "submitting" });
  await assert.rejects(
    completeProviderStage(job.id, "old-worker", {
      kind: "task",
      id: "fixture-task",
    }),
    (error: unknown) => (error as { code: string }).code === "LEASE_ENDED",
  );
  assert.equal((await jobRecord(job.id)).provider_task_id, null);
  await updateJob(job.id, {
    status: "cancelled",
    lease_owner: null,
    lease_until: null,
  });
});
