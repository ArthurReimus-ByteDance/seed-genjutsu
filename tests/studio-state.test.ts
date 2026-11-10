import test from "node:test";
import assert from "node:assert/strict";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { randomUUID } from "node:crypto";
import { studioQueryKeys } from "../src/lib/api";
import type { Job } from "../src/lib/schemas";
import { reconcileJob } from "../src/lib/studio-cache";
import { normalizeClip } from "../src/lib/video-models";
import {
  createJobSchema,
  type Capabilities,
  type Upload,
} from "../src/lib/schemas";
import {
  switchDirection,
  moveReference,
  workflowSettings,
  workflowConnected,
  workflowInputIssue,
  enhancementContextKey,
  reviewMedia,
} from "../src/components/studio/workflow-state";

function job(status: Job["status"], seconds: number): Job {
  return {
    id: randomUUID(),
    status,
    updatedAt: new Date(seconds * 1000).toISOString(),
    events: [
      {
        id: seconds,
        stage: status,
        message: status,
        createdAt: new Date(seconds * 1000).toISOString(),
      },
    ],
  } as Job;
}
test("a late detail read cannot restore approval state after a mutation", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const keys = studioQueryKeys("live");
  const original = job("awaiting_approval", 1);
  const approved = { ...job("generating", 2), id: original.id };
  client.setQueryData(keys.job(original.id), original);
  let resolveRead!: (value: Job) => void;
  let reads = 0;
  const observer = new QueryObserver(client, {
    queryKey: keys.job(original.id),
    queryFn: () => {
      reads++;
      return reads === 1
        ? new Promise<Job>((resolve) => {
            resolveRead = resolve;
          })
        : Promise.resolve(approved);
    },
    staleTime: 0,
  });
  const unsubscribe = observer.subscribe(() => {});
  try {
    assert.equal(reads, 1);
    await reconcileJob(client, keys, approved);
    resolveRead(original);
    await Promise.resolve();
    assert.equal(
      client.getQueryData<Job>(keys.job(original.id))?.status,
      "generating",
    );
  } finally {
    unsubscribe();
    client.clear();
  }
});

test("cache reconciliation does not replace a newer take or navigate to a different selection", async () => {
  const client = new QueryClient();
  const keys = studioQueryKeys("demo");
  const older = job("processing", 1);
  const latest = { ...job("succeeded", 3), id: older.id };
  const selected = job("awaiting_approval", 2);
  client.setQueryData(keys.job(older.id), latest);
  client.setQueryData(keys.job(selected.id), selected);
  await reconcileJob(client, keys, older);
  assert.equal(
    client.getQueryData<Job>(keys.job(older.id))?.status,
    "succeeded",
  );
  assert.equal(client.getQueryData(keys.job(selected.id)), selected);
  client.clear();
});

test("clip normalization clamps drafts against the source and selected model for every submission path", () => {
  assert.deepEqual(
    normalizeClip({
      start: 0,
      duration: 10,
      sourceDuration: 6,
      model: "seedance-2",
    }),
    { start: 0, duration: 6 },
  );
  assert.deepEqual(
    normalizeClip({
      start: 90,
      duration: 30,
      sourceDuration: 6,
      model: "seedance-2.5",
    }),
    { start: 2, duration: 4 },
  );
  assert.deepEqual(
    normalizeClip({
      start: Number.NaN,
      duration: Number.NaN,
      sourceDuration: 6,
      model: "seedance-2",
    }),
    { start: 0, duration: 4 },
  );
  assert.deepEqual(
    normalizeClip({
      start: -1,
      duration: 4.9,
      sourceDuration: 20,
      model: "seedance-2",
    }),
    { start: 0, duration: 4 },
  );
  assert.deepEqual(
    normalizeClip({
      start: 0,
      duration: 30,
      sourceDuration: 40,
      model: "seedance-2",
    }),
    { start: 0, duration: 15 },
  );
  assert.deepEqual(
    normalizeClip({
      start: 0.3,
      duration: 4.5,
      sourceDuration: 6,
      model: "seedance-2.5",
    }),
    { start: 0.3, duration: 4.5 },
  );
});

const media = (kind: Upload["kind"] = "character"): Upload => ({
  id: randomUUID(),
  kind,
  name: "Uploaded reference",
  mime: kind === "video" ? "video/mp4" : "image/png",
  bytes: 1000,
  duration: kind === "video" ? 6 : null,
  width: 640,
  height: 360,
  url: "/api/media/" + randomUUID(),
  posterUrl: null,
});
const reference = (role: Job["references"][number]["role"] = "character") => ({
  id: randomUUID(),
  role,
  media: media(),
});

test("workflow switches restore authored directions including intentionally empty preset direction", () => {
  const initial = {
    workflow: "character_swap" as const,
    prompt: "My authored swap.",
    directions: {},
  };
  const edit = switchDirection(initial, "element_edit");
  assert.equal(edit.prompt, "");
  const restyle = switchDirection(
    { ...edit, prompt: "Replace the sign." },
    "restyle",
  );
  const swap = switchDirection(restyle, "character_swap");
  assert.equal(swap.prompt, "My authored swap.");
  const restoredEdit = switchDirection(swap, "element_edit");
  assert.equal(restoredEdit.prompt, "Replace the sign.");
  assert.equal(switchDirection(restoredEdit, "restyle").prompt, "");
});

test("new workflow submissions force editing settings without losing reusable ordered references", () => {
  const source = media("video");
  const character = media();
  const references = [reference("scene"), reference("character")];
  for (const workflow of [
    "element_edit",
    "motion_transfer",
    "restyle",
  ] as const) {
    const settings = workflowSettings({
      workflow,
      model: "seedance-2",
      prepareImage: true,
      character,
      references,
    });
    const config = createJobSchema.parse({
      ...settings,
      sourceId: source.id,
      prompt: "My authored transformation.",
      operation: "remove",
      stylePreset: "noir",
      duration: 4,
    });
    assert.equal(config.model, "seedance-2.5");
    assert.equal(config.prepareImage, false);
    assert.equal(config.characterId, undefined);
    assert.deepEqual(
      config.references,
      references.map(({ id, role, media }) => ({
        id,
        role,
        mediaId: media.id,
      })),
    );
    assert.equal(config.operation, "remove");
    assert.equal(config.stylePreset, "noir");
    assert.equal(config.stylePresetRevision, 1);
  }
  const swap = workflowSettings({
    workflow: "character_swap",
    model: "seedance-2",
    prepareImage: true,
    character,
    references,
  });
  assert.equal(swap.model, "seedance-2");
  assert.equal(swap.prepareImage, true);
  assert.equal(swap.characterId, character.id);
  assert.deepEqual(swap.references, []);
});

test("reference reordering keeps identity roles and media intact and ignores missing or boundary moves", () => {
  const references = [
    reference("style"),
    reference("scene"),
    reference("identity"),
  ];
  assert.deepEqual(moveReference(references, references[1].id, -1), [
    references[1],
    references[0],
    references[2],
  ]);
  assert.deepEqual(moveReference(references, references[1].id, 1), [
    references[0],
    references[2],
    references[1],
  ]);
  assert.deepEqual(moveReference(references, references[0].id, -1), references);
  assert.deepEqual(moveReference(references, references[2].id, 1), references);
  assert.deepEqual(moveReference(references, randomUUID(), 1), references);
  assert.deepEqual(moveReference([], randomUUID(), 1), []);
  assert.equal(references[0].role, "style");
});

test("new modes require core services but not SAM or optional enhancement and image services", () => {
  const capabilities = {
    video: true,
    storage: true,
    portraits: true,
    workerSeenAt: new Date().toISOString(),
    sam: false,
    image: false,
    promptEnhancement: false,
    missing: ["SAM"],
  } as Capabilities;
  for (const workflow of [
    "element_edit",
    "motion_transfer",
    "restyle",
  ] as const) {
    assert.equal(workflowConnected(capabilities, workflow, true), true);
    for (const service of [
      "video",
      "storage",
      "portraits",
      "workerSeenAt",
    ] as const) {
      assert.equal(
        workflowConnected(
          {
            ...capabilities,
            [service]: service === "workerSeenAt" ? null : false,
          },
          workflow,
        ),
        false,
      );
    }
  }
  assert.equal(workflowConnected(capabilities, "character_swap"), false);
  assert.equal(
    workflowConnected({ ...capabilities, sam: true }, "character_swap"),
    true,
  );
  assert.equal(
    workflowConnected({ ...capabilities, sam: true }, "character_swap", true),
    false,
  );
  assert.equal(workflowConnected(undefined, "restyle"), false);
});

test("input readiness permits video-only editing and preset restyle but requires motion cast or scene", () => {
  const draft = {
    workflow: "restyle" as const,
    source: media("video"),
    character: null,
    references: [],
    prompt: "",
    stylePreset: "watercolor" as const,
  };
  assert.equal(workflowInputIssue(draft), null);
  assert.ok(workflowInputIssue({ ...draft, source: null }));
  assert.ok(workflowInputIssue({ ...draft, stylePreset: "custom" }));
  assert.equal(
    workflowInputIssue({
      ...draft,
      stylePreset: "custom",
      references: [reference("style")],
    }),
    null,
  );
  assert.ok(
    workflowInputIssue({
      ...draft,
      stylePreset: "custom",
      references: [reference("object")],
    }),
  );
  assert.equal(
    createJobSchema.safeParse({
      ...workflowSettings({
        ...draft,
        model: "seedance-2",
        prepareImage: false,
        references: [reference("style")],
      }),
      sourceId: draft.source.id,
      prompt: "",
      duration: 4,
    }).success,
    true,
  );
  assert.ok(workflowInputIssue({ ...draft, workflow: "character_swap" }));
  assert.ok(
    workflowInputIssue({
      ...draft,
      workflow: "motion_transfer",
      prompt: "Transfer this motion.",
      references: [reference("style")],
    }),
  );
  assert.equal(
    workflowInputIssue({
      ...draft,
      workflow: "motion_transfer",
      prompt: "Transfer this motion.",
      references: [reference("scene")],
    }),
    null,
  );
  assert.equal(
    workflowInputIssue({
      ...draft,
      workflow: "element_edit",
      prompt: "Remove this object.",
    }),
    null,
  );
});

test("enhancement context changes with workflow operation preset roles order and replacement media", () => {
  const context = {
    workflow: "element_edit" as const,
    operation: "modify" as const,
    stylePreset: "custom" as const,
    references: [reference("object"), reference("scene")],
  };
  const key = enhancementContextKey(context);
  assert.equal(
    enhancementContextKey({ ...context, references: [...context.references] }),
    key,
  );
  for (const change of [
    { workflow: "restyle" as const },
    { operation: "remove" as const },
    { stylePreset: "anime" as const },
    { references: [...context.references].reverse() },
    {
      references: [
        { ...context.references[0], role: "garment" as const },
        context.references[1],
      ],
    },
    {
      references: [
        { ...context.references[0], media: media() },
        context.references[1],
      ],
    },
    { references: [] },
  ])
    assert.notEqual(enhancementContextKey({ ...context, ...change }), key);
});

test("review media uses the prepared original for new workflows and the subject video only for swaps", () => {
  const prepared = media("prepared");
  const masked = media("masked");
  for (const workflow of [
    "element_edit",
    "motion_transfer",
    "restyle",
  ] as const) {
    const take = { config: { workflow }, prepared, masked } as Job;
    assert.equal(reviewMedia(take), prepared);
    assert.equal(reviewMedia({ ...take, prepared: null }), null);
  }
  assert.equal(
    reviewMedia({
      config: { workflow: "character_swap" },
      prepared,
      masked,
    } as Job),
    masked,
  );
});
