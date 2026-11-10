import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { advanceDemo, type DemoRecord } from "../src/server/demo/lifecycle";
import { jobSchema, capabilitySchema, type Upload } from "../src/lib/schemas";
import { effectiveDirection, type WorkflowId } from "../src/lib/workflows";
const root = await mkdtemp(path.join(tmpdir(), "genjutsu-demo-test-"));
process.env.MEDIA_ROOT = root;
process.env.DEMO_ENABLED = "true";
const { demoHandler } = await import("../src/server/demo/handler");
const { withDemo, sampleReferences, saveDemoMedia, demoRoot } =
  await import("../src/server/demo/store");
const { env } = await import("../src/env");
after(() => rm(root, { recursive: true, force: true }));
beforeEach(() =>
  withDemo(async (store) => {
    store.jobs = [];
    store.uploads = [];
  }),
);
const now = Date.parse("2026-11-05T04:00:00Z");
function fixture(prepareImage = true): DemoRecord {
  const upload: Upload = {
    id: "778d0cec-6b6b-4f0b-b5e4-260c86a6a893",
    kind: "video",
    name: "Source.mp4",
    mime: "video/mp4",
    url: "/api/demo/media/source",
    posterUrl: null,
    width: 1280,
    height: 720,
    duration: 6,
    bytes: 1000,
  };
  const config = {
    model: "seedance-2" as const,
    sourceId: upload.id,
    characterId: upload.id,
    prompt: "Replace the performer and keep the scene.",
    target: "person",
    start: 0,
    duration: 4,
    resolution: "720p" as const,
    prepareImage,
    preserveAudio: true,
    reviewBeforeGeneration: true,
  };
  const job = jobSchema.parse({
    id: "fe505fce-e8a4-4dc7-bbd9-79645d082c5f",
    name: "Sample",
    prompt: config.prompt,
    config,
    source: upload,
    character: { ...upload, kind: "character", mime: "image/jpeg" },
    frame: null,
    anchor: null,
    masked: null,
    result: null,
    status: "queued",
    stage: "queued",
    progress: 5,
    error: null,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    events: [],
  });
  return {
    job,
    scenario: "success",
    approvedAt: null,
    prepared: null,
    masked: { ...upload, kind: "masked" },
    anchor: { ...upload, kind: "anchor", mime: "image/jpeg" },
    result: { ...upload, kind: "result" },
  };
}
function workflowFixture(workflow: WorkflowId): DemoRecord {
  const record = fixture(false);
  record.job.config.workflow = workflow;
  record.job.config.model = "seedance-2.5";
  delete record.job.config.characterId;
  record.job.character = null;
  record.masked = null;
  record.anchor = null;
  record.prepared = { ...record.job.source, kind: "prepared" };
  if (workflow === "motion_transfer") {
    const image = {
      ...record.job.source,
      id: randomUUID(),
      kind: "character" as const,
      mime: "image/jpeg",
      duration: null,
    };
    const reference = {
      id: randomUUID(),
      role: "scene" as const,
      media: image,
    };
    record.job.references = [reference];
    record.job.config.references = [
      {
        id: reference.id,
        role: reference.role,
        mediaId: image.id,
      },
    ];
  }
  return record;
}

test("preview shows source refinement and video mask verification only for swaps without claiming inference quality", () => {
  const refining = advanceDemo(fixture(), now + 1000);
  assert.equal(refining.job.stage, "prompt_refinement");
  assert.match(refining.job.events.at(-1)!.message, /simulated/);
  assert.equal(refining.job.samRefinement, undefined);
  const record = advanceDemo(fixture(), now + 4000);
  assert.equal(record.job.stage, "mask_verification");
  assert.match(record.job.events.at(-1)!.message, /simulated/);
  assert.equal(record.job.maskVerifications, undefined);
  for (const workflow of [
    "element_edit",
    "motion_transfer",
    "restyle",
  ] as const) {
    assert.notEqual(
      advanceDemo(workflowFixture(workflow), now + 1000).job.stage,
      "prompt_refinement",
    );
    assert.notEqual(
      advanceDemo(workflowFixture(workflow), now + 4000).job.stage,
      "mask_verification",
    );
  }
});
async function request(
  endpoint: string,
  input?: unknown,
  scenario = "success",
) {
  const response = await demoHandler(
    new Request(
      env.APP_URL + "/api/demo/" + endpoint,
      input === undefined
        ? {}
        : {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Recast-Scenario": scenario,
            },
            body: JSON.stringify(input),
          },
    ),
    endpoint.split("?")[0].split("/"),
  );
  return { status: response.status, body: await response.json() };
}
async function newWorkflowInput(workflow: WorkflowId) {
  const samples = await withDemo(sampleReferences);
  return {
    sourceId: samples.source.id,
    model: "seedance-2.5",
    workflow,
    prompt:
      workflow === "restyle" ? "" : "Change the selected clip as directed.",
    stylePreset: workflow === "restyle" ? "watercolor" : "custom",
    duration: 4,
    resolution: "480p",
    references:
      workflow === "motion_transfer"
        ? [
            {
              id: randomUUID(),
              mediaId: samples.character.id,
              role: "scene",
            },
          ]
        : [],
  };
}
async function agePreparation(id: string) {
  await withDemo(async (store) => {
    const record = store.jobs.find((record) => record.job.id === id)!;
    record.job.createdAt = new Date(Date.now() - 7000).toISOString();
  });
}
async function ageGeneration(id: string) {
  await withDemo(async (store) => {
    const record = store.jobs.find((record) => record.job.id === id)!;
    record.approvedAt = new Date(Date.now() - 11000).toISOString();
  });
}
test("preview preparation stops at human review and never reveals a result before approval", () => {
  const prepared = advanceDemo(fixture(), now + 7000);
  assert.equal(prepared.job.status, "awaiting_approval");
  assert.ok(prepared.job.masked);
  assert.ok(prepared.job.anchor);
  assert.equal(prepared.job.result, null);
  const later = advanceDemo(prepared, now + 600000);
  assert.equal(later.job.status, "awaiting_approval");
  assert.equal(later.job.result, null);
});
test("optional scene preparation can be skipped while keeping the character input", () => {
  const prepared = advanceDemo(fixture(false), now + 7000);
  assert.equal(prepared.job.anchor, null);
  assert.ok(prepared.job.masked);
  assert.ok(prepared.job.character);
});
test("an approved preview reaches a simulated result and duplicate reads stay stable", () => {
  const record = fixture();
  record.approvedAt = new Date(now + 7000).toISOString();
  record.job.status = "processing";
  record.job.stage = "registering";
  const complete = advanceDemo(record, now + 18000);
  assert.equal(complete.job.status, "succeeded");
  assert.equal(complete.job.result?.kind, "result");
  assert.deepEqual(advanceDemo(complete, now + 600000), complete);
});
test("an automatic preview completes from one submission after preparation", () => {
  const record = fixture();
  record.job.config.reviewBeforeGeneration = false;
  const preparing = advanceDemo(record, now + 5000);
  assert.equal(preparing.job.stage, "image_preparation");
  const ready = advanceDemo(preparing, now + 7000);
  assert.equal(ready.job.stage, "registering");
  assert.ok(ready.job.masked && ready.job.anchor);
  assert.equal(ready.approvedAt, null);
  const complete = advanceDemo(ready, now + 17000);
  assert.equal(complete.job.status, "succeeded");
  assert.equal(complete.job.result?.kind, "result");
});
test("preview failure and cancellation never become successful takes", () => {
  const record = fixture();
  record.scenario = "failure";
  record.approvedAt = new Date(now).toISOString();
  record.job.status = "generating";
  record.job.stage = "generating";
  const failed = advanceDemo(record, now + 11000);
  assert.equal(failed.job.status, "failed");
  assert.equal(failed.job.result, null);
  assert.match(failed.job.error ?? "", /sample provider/);
  const cancelled = fixture();
  cancelled.job.status = "cancelled";
  assert.equal(advanceDemo(cancelled, now + 600000).job.status, "cancelled");
});

for (const workflow of [
  "element_edit",
  "motion_transfer",
  "restyle",
] as const) {
  test(`${workflow} reviews the original prepared video without masking or image preparation`, () => {
    const record = workflowFixture(workflow);
    const trimming = advanceDemo(record, now + 2000);
    assert.equal(trimming.job.stage, "trimming");
    assert.equal(trimming.job.masked, null);
    const review = advanceDemo(trimming, now + 7000);
    assert.equal(review.job.status, "awaiting_approval");
    assert.deepEqual(review.job.prepared, record.prepared);
    assert.equal(review.job.character, null);
    assert.equal(review.job.masked, null);
    assert.equal(review.job.anchor, null);
    assert.equal(review.job.result, null);
    assert.match(
      review.job.events.at(-1)?.message ?? "",
      /original.*prepared/i,
    );
    assert.deepEqual(advanceDemo(review, now + 600000), review);
  });

  test(`${workflow} simulates registration, eligibility, generation and prerecorded completion`, () => {
    let record = workflowFixture(workflow);
    record.job.config.reviewBeforeGeneration = false;
    for (const [offset, stage, status] of [
      [7000, "registering", "processing"],
      [9000, "asset_review", "processing"],
      [12000, "generating", "generating"],
      [17000, "complete", "succeeded"],
    ] as const) {
      record = advanceDemo(record, now + offset);
      assert.equal(record.job.stage, stage);
      assert.equal(record.job.status, status);
      assert.equal(record.job.masked, null);
      assert.ok(record.job.prepared);
      assert.equal(record.job.result !== null, status === "succeeded");
      assert.equal(jobSchema.safeParse(record.job).success, true);
    }
    assert.ok(
      record.job.events.some((event) =>
        /Active status does not verify real-person authorization or media rights/.test(
          event.message,
        ),
      ),
    );
    assert.match(
      record.job.events.at(-1)?.message ?? "",
      /simulated.*prerecorded/i,
    );
    assert.deepEqual(advanceDemo(record, now + 600000), record);
  });

  test(`${workflow} failure and cancellation are terminal and never expose prerecorded output`, () => {
    const failing = workflowFixture(workflow);
    failing.scenario = "failure";
    failing.job.config.reviewBeforeGeneration = false;
    const failed = advanceDemo(failing, now + 17000);
    assert.equal(failed.job.status, "failed");
    assert.equal(failed.job.result, null);
    assert.match(failed.job.error ?? "", /simulated/i);
    assert.deepEqual(advanceDemo(failed, now + 600000), failed);
    for (const offset of [0, 7000, 12000]) {
      const automatic = workflowFixture(workflow);
      automatic.job.config.reviewBeforeGeneration = false;
      const cancelled = advanceDemo(automatic, now + offset);
      cancelled.job.status = "cancelled";
      assert.deepEqual(advanceDemo(cancelled, now + 600000), cancelled);
      assert.equal(cancelled.job.result, null);
    }
  });

  test(`${workflow} HTTP creation persists original prepared media and completes only after approval`, async () => {
    const input = await newWorkflowInput(workflow);
    const created = await request("jobs", input);
    assert.equal(created.status, 202);
    const job = jobSchema.parse(created.body.job);
    assert.equal(job.character, null);
    assert.equal(job.prepared, null);
    assert.ok(job.frame);
    assert.equal(job.masked, null);
    assert.equal(job.anchor, null);
    assert.match(job.events[0].message, /fixed prerecorded sample/);
    assert.match(
      job.events[0].message,
      /does not validate real-person authorization, media rights, provider eligibility or model output quality/,
    );
    assert.equal(job.name, effectiveDirection(job.config).slice(0, 60));
    assert.deepEqual(
      job.references.map(({ id, role, media }) => ({
        id,
        role,
        mediaId: media.id,
      })),
      input.references,
    );
    assert.equal((await request(`jobs/${job.id}/approve`, {})).status, 409);
    await agePreparation(job.id);
    const review = jobSchema.parse((await request(`jobs/${job.id}`)).body.job);
    assert.equal(review.status, "awaiting_approval");
    assert.equal(review.prepared?.kind, "prepared");
    assert.equal(review.masked, null);
    assert.equal(review.anchor, null);
    assert.equal(review.result, null);
    const prepared = await demoHandler(
      new Request(env.APP_URL + review.prepared!.url),
      ["media", review.prepared!.id],
    );
    assert.equal(prepared.status, 200);
    assert.ok((await prepared.arrayBuffer()).byteLength > 1000);
    const approvals = await Promise.all([
      request(`jobs/${job.id}/approve`, {}),
      request(`jobs/${job.id}/approve`, {}),
    ]);
    assert.deepEqual(
      approvals.map((response) => response.status).sort(),
      [200, 409],
    );
    const approved = approvals.find((response) => response.status === 200)!;
    assert.equal(approved.body.job.stage, "registering");
    assert.equal((await request(`jobs/${job.id}/approve`, {})).status, 409);
    await ageGeneration(job.id);
    const complete = jobSchema.parse(
      (await request(`jobs/${job.id}`)).body.job,
    );
    assert.equal(complete.status, "succeeded");
    assert.match(complete.result?.name ?? "", /simulated.*prerecorded/i);
    assert.match(complete.events.at(-1)?.message ?? "", /prerecorded/i);
    assert.deepEqual(complete.references, job.references);
    assert.equal(complete.masked, null);
    const history = await request("jobs");
    assert.equal(history.body.jobs[0].id, job.id);
  });

  test(`${workflow} HTTP failure and cancellation remain stable`, async () => {
    const input = await newWorkflowInput(workflow);
    const created = await request("jobs", input, "failure");
    assert.equal(created.status, 202);
    const id = created.body.job.id;
    await agePreparation(id);
    assert.equal((await request(`jobs/${id}/approve`, {})).status, 200);
    await ageGeneration(id);
    const failed = await request(`jobs/${id}`);
    assert.equal(failed.body.job.status, "failed");
    assert.equal(failed.body.job.result, null);
    assert.equal((await request(`jobs/${id}/cancel`, {})).status, 409);
    const cancelling = await request("jobs", input);
    assert.equal(cancelling.status, 202);
    const cancelledId = cancelling.body.job.id;
    await agePreparation(cancelledId);
    const cancelled = await request(`jobs/${cancelledId}/cancel`, {});
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.job.status, "cancelled");
    assert.equal(
      (await request(`jobs/${cancelledId}/approve`, {})).status,
      409,
    );
    await ageGeneration(cancelledId);
    const later = await request(`jobs/${cancelledId}`);
    assert.equal(later.body.job.status, "cancelled");
    assert.equal(later.body.job.result, null);
  });
}

test("legacy preview workspaces default missing workflow fields and retain mask review", async () => {
  await withDemo(async (store) => {
    store.jobs.push(fixture());
  });
  const file = path.join(demoRoot, "local", "workspace.json");
  const state = JSON.parse(await readFile(file, "utf8"));
  const record = state.jobs[0];
  delete record.prepared;
  for (const field of [
    "workflow",
    "references",
    "operation",
    "stylePreset",
    "stylePresetRevision",
  ]) {
    delete record.job.config[field];
  }
  delete record.job.config.model;
  delete record.job.references;
  delete record.job.prepared;
  await writeFile(file, JSON.stringify(state));
  await withDemo(async (store) => {
    const job = store.jobs[0].job;
    assert.equal(job.config.workflow, "character_swap");
    assert.equal(job.config.model, "seedance-2.5");
    assert.equal(job.config.stylePresetRevision, 1);
    assert.deepEqual(job.references, []);
    assert.equal(job.prepared, null);
    assert.equal(job.status, "awaiting_approval");
    assert.ok(job.masked);
    assert.ok(job.anchor);
    assert.equal(store.jobs[0].prepared, null);
  });
});

test("preview validates missing, wrong-kind and malformed ordered image references before saving jobs", async () => {
  const input = await newWorkflowInput("element_edit");
  const reference = { id: randomUUID(), role: "object", mediaId: randomUUID() };
  assert.equal(
    (await request("jobs", { ...input, references: [reference] })).status,
    404,
  );
  assert.equal(
    (
      await request("jobs", {
        ...input,
        references: [{ ...reference, mediaId: input.sourceId }],
      })
    ).status,
    400,
  );
  const image = await withDemo(async (store) =>
    saveDemoMedia(store, {
      kind: "character",
      name: "Image.jpg",
      mime: "image/jpeg",
      bytes: 1000,
      width: 600,
      height: 600,
      duration: null,
      file: path.join(process.cwd(), "public/samples/character.jpg"),
    }),
  );
  for (const patch of [
    { width: 299 },
    { height: 6001 },
    { width: 300, height: 1000 },
    { bytes: 30 * 1024 * 1024 },
    { bytes: 0 },
    { mime: "video/mp4" },
    { duration: 4 },
  ]) {
    await withDemo(async (store) => {
      Object.assign(
        store.uploads.find((upload) => upload.id === image.id)!,
        image,
        patch,
      );
    });
    assert.equal(
      (
        await request("jobs", {
          ...input,
          references: [{ ...reference, mediaId: image.id }],
        })
      ).status,
      400,
    );
  }
  assert.equal((await request("jobs")).body.jobs.length, 0);
});

test("preview rejects invalid workflow configurations and accepts the ordered 30-image boundary", async () => {
  const input = await newWorkflowInput("element_edit");
  const references = await withDemo(async (store) => {
    const references = [];
    for (let index = 0; index < 30; index++) {
      const image = await saveDemoMedia(store, {
        kind: "character",
        name: "Image.jpg",
        mime: "image/jpeg",
        bytes: 1000,
        width: 600,
        height: 600,
        duration: null,
        file: path.join(process.cwd(), "public/samples/character.jpg"),
      });
      references.push({
        id: randomUUID(),
        mediaId: image.id,
        role: (
          [
            "style",
            "scene",
            "garment",
            "object",
            "identity",
            "character",
          ] as const
        )[index % 6],
      });
    }
    return references;
  });
  for (const patch of [
    { workflow: "unknown" },
    { model: "seedance-2" },
    { prepareImage: true },
    { characterId: references[0].mediaId },
    { prompt: "" },
    { workflow: "motion_transfer", references: [] },
    {
      workflow: "motion_transfer",
      references: [{ ...references[0], role: "style" }],
    },
    { references: [references[0], references[0]] },
    { references: [references[0], { ...references[0], id: randomUUID() }] },
    {
      references: [
        ...references,
        { ...references[0], id: randomUUID(), mediaId: randomUUID() },
      ],
    },
    { stylePresetRevision: 2 },
    { stylePreset: "unknown" },
    { start: 4 },
  ]) {
    assert.equal((await request("jobs", { ...input, ...patch })).status, 400);
  }
  const created = await request("jobs", { ...input, references });
  assert.equal(created.status, 202);
  assert.deepEqual(
    created.body.job.references.map(
      ({ id, role, media }: { id: string; role: string; media: Upload }) => ({
        id,
        role,
        mediaId: media.id,
      }),
    ),
    references,
  );
  await withDemo(async (store) => {
    store.uploads = store.uploads.filter(
      (upload) => upload.id !== references[0].mediaId,
    );
  });
  assert.equal((await request(`jobs/${created.body.job.id}`)).status, 404);
  assert.equal((await request("jobs")).status, 404);
});

test("preview approval checks the actual selected prepared media and revalidates image references", async () => {
  const input = await newWorkflowInput("motion_transfer");
  const created = await request("jobs", input);
  assert.equal(created.status, 202);
  const id = created.body.job.id;
  await agePreparation(id);
  await request(`jobs/${id}`);
  const selected = await withDemo(async (store) => {
    const record = store.jobs[0];
    const prepared = record.job.prepared!;
    record.job.prepared = null;
    return prepared;
  });
  assert.equal((await request(`jobs/${id}/approve`, {})).status, 409);
  await withDemo(async (store) => {
    store.jobs[0].job.prepared = selected;
    store.uploads.find((upload) => upload.id === selected.id)!.kind = "masked";
  });
  assert.equal((await request(`jobs/${id}/approve`, {})).status, 400);
  await withDemo(async (store) => {
    store.uploads.find((upload) => upload.id === selected.id)!.kind =
      "prepared";
    store.uploads.find(
      (upload) => upload.id === input.references[0].mediaId,
    )!.width = 299;
  });
  assert.equal((await request(`jobs/${id}/approve`, {})).status, 400);
  await withDemo(async (store) => {
    store.uploads.find(
      (upload) => upload.id === input.references[0].mediaId,
    )!.width = 1280;
  });
  assert.equal((await request(`jobs/${id}/approve`, {})).status, 200);
});

test("preview capability and preset discovery do not claim model quality qualification", async () => {
  const response = await request("capabilities");
  assert.equal(response.status, 200);
  const capabilities = capabilitySchema.parse(response.body);
  assert.equal(capabilities.workflows.length, 4);
  for (const workflow of capabilities.workflows) {
    assert.equal(workflow.requiresSam, workflow.id === "character_swap");
    assert.equal(workflow.qualityValidated, false);
    assert.equal(workflow.configured, true);
  }
  const presets = await request("presets?workflow=restyle");
  assert.equal(presets.status, 200);
  assert.ok(
    presets.body.presets.some(
      (preset: { id: string }) => preset.id === "watercolor",
    ),
  );
  assert.ok(
    presets.body.presets.every(
      (preset: { revision: number; qualityValidated: boolean }) =>
        preset.revision === 1 && !preset.qualityValidated,
    ),
  );
  assert.equal((await request("presets?workflow=element_edit")).status, 400);
});

test("style-image-only restyle uses effective direction for its name and retains an empty custom prompt", async () => {
  const input = await newWorkflowInput("restyle");
  const samples = await withDemo(sampleReferences);
  const references = [
    {
      id: randomUUID(),
      mediaId: samples.character.id,
      role: "style",
    },
  ];
  const created = await request("jobs", {
    ...input,
    stylePreset: "custom",
    references,
  });
  assert.equal(created.status, 202);
  const job = jobSchema.parse(created.body.job);
  assert.equal(job.prompt, "");
  assert.equal(job.config.prompt, "");
  assert.equal(job.config.stylePresetRevision, 1);
  assert.equal(job.name, effectiveDirection(job.config).slice(0, 60));
  assert.ok(job.name.length >= 10);
  assert.equal(job.references[0].role, "style");
  await agePreparation(job.id);
  assert.equal((await request(`jobs/${job.id}/approve`, {})).status, 200);
  await ageGeneration(job.id);
  assert.equal((await request(`jobs/${job.id}`)).body.job.status, "succeeded");
});

test("legacy HTTP submissions keep the default model, character, mask and optional scene branch", async () => {
  const samples = await withDemo(sampleReferences);
  for (const prepareImage of [true, false]) {
    const created = await request("jobs", {
      sourceId: samples.source.id,
      characterId: samples.character.id,
      prompt: "Replace the performer and keep the scene.",
      duration: 4,
      resolution: "480p",
      prepareImage,
      staleLegacyField: "stripped",
    });
    assert.equal(created.status, 202);
    const job = jobSchema.parse(created.body.job);
    assert.equal(job.config.workflow, "character_swap");
    assert.equal(job.config.model, "seedance-2");
    assert.equal(job.character?.id, samples.character.id);
    assert.deepEqual(job.references, []);
    assert.equal(job.prepared, null);
    assert.equal("staleLegacyField" in created.body.job.config, false);
    await agePreparation(job.id);
    const review = jobSchema.parse((await request(`jobs/${job.id}`)).body.job);
    assert.ok(review.masked);
    assert.equal(review.prepared, null);
    assert.equal(review.anchor !== null, prepareImage);
    assert.equal((await request(`jobs/${job.id}/approve`, {})).status, 200);
    await ageGeneration(job.id);
    assert.equal(
      (await request(`jobs/${job.id}`)).body.job.status,
      "succeeded",
    );
  }
});

test("preview rejects unsupported source media metadata and unknown new-workflow fields", async () => {
  const input = await newWorkflowInput("element_edit");
  const source = await withDemo(async (store) => ({ ...store.uploads[0] }));
  for (const patch of [
    { kind: "character" },
    { mime: "image/jpeg" },
    { duration: null },
    { duration: 3 },
    { width: 0 },
    { width: 10000, height: 10000 },
    { width: 300, height: -1 },
    { bytes: 0 },
    { bytes: 250 * 1024 * 1024 + 1 },
  ]) {
    await withDemo(async (store) => {
      Object.assign(
        store.uploads.find((upload) => upload.id === source.id)!,
        source,
        patch,
      );
    });
    assert.equal((await request("jobs", input)).status, 400);
  }
  await withDemo(async (store) => {
    Object.assign(
      store.uploads.find((upload) => upload.id === source.id)!,
      source,
    );
  });
  assert.equal(
    (await request("jobs", { ...input, unknownSetting: true })).status,
    400,
  );
  assert.equal((await request("jobs")).body.jobs.length, 0);
});

test("preview review rejects missing prepared media and out-of-limit prepared metadata without approving", async () => {
  const input = await newWorkflowInput("element_edit");
  const created = await request("jobs", input);
  assert.equal(created.status, 202);
  const id = created.body.job.id;
  await agePreparation(id);
  await request(`jobs/${id}`);
  const prepared = await withDemo(async (store) => {
    const preparedId = store.jobs[0].job.prepared!.id;
    return { ...store.uploads.find((upload) => upload.id === preparedId)! };
  });
  for (const patch of [
    { mime: "video/quicktime" },
    { width: 299 },
    { width: 300, height: 300 },
    { width: 5000, height: 5000 },
    { bytes: 200 * 1024 * 1024 + 1 },
    { duration: null },
    { duration: 3.9 },
    { duration: 5 },
  ]) {
    await withDemo(async (store) => {
      Object.assign(
        store.uploads.find((upload) => upload.id === prepared.id)!,
        prepared,
        patch,
      );
    });
    assert.equal((await request(`jobs/${id}/approve`, {})).status, 400);
    await withDemo(async (store) => {
      assert.equal(store.jobs[0].approvedAt, null);
      assert.equal(store.jobs[0].job.status, "awaiting_approval");
    });
  }
  await withDemo(async (store) => {
    store.uploads = store.uploads.filter((upload) => upload.id !== prepared.id);
  });
  assert.equal((await request(`jobs/${id}/approve`, {})).status, 404);
});
