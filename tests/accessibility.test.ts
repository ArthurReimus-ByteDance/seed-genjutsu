import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Slider } from "../src/components/ui/slider";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { WorkflowControls } from "../src/components/studio/workflow-controls";
import { MediaCanvas, RunDetails } from "../src/components/studio/canvas";
import { Library } from "../src/components/studio/library";
import { UploadTile } from "../src/components/upload-tile";
import { createJobSchema, type Job, type Upload } from "../src/lib/schemas";
import { api } from "../src/lib/api";
import {
  refinementFixture,
  verificationFixture,
} from "../scripts/fixtures/meta-sam";

const require = createRequire(import.meta.url);
const { ReferenceTray } =
  require("../src/components/studio/reference-tray.tsx") as typeof import("../src/components/studio/reference-tray");
const noop = () => {};
const media = (kind: Upload["kind"] = "character"): Upload => ({
  id: randomUUID(),
  kind,
  name: "Reference",
  mime: kind === "character" ? "image/png" : "video/mp4",
  bytes: 1000,
  duration: kind === "character" ? null : 4,
  width: 640,
  height: 360,
  url: "/api/media/" + randomUUID(),
  posterUrl: null,
});
function reviewJob(): Job {
  const source = media("video");
  return {
    id: randomUUID(),
    name: "Watercolor take",
    prompt: "",
    config: createJobSchema.parse({
      workflow: "restyle",
      stylePreset: "watercolor",
      model: "seedance-2.5",
      sourceId: source.id,
      prompt: "",
      duration: 4,
    }),
    source,
    character: null,
    references: [],
    prepared: media("prepared"),
    frame: null,
    masked: null,
    anchor: null,
    result: null,
    error: null,
    status: "awaiting_approval",
    stage: "review",
    progress: 40,
    createdAt: "2026-11-09T00:00:00Z",
    updatedAt: "2026-11-09T00:00:00Z",
    events: [],
  };
}

test("source refinement displays a distinct stage and preserves the original description in run details", () => {
  const job = reviewJob();
  const character = media();
  job.config = createJobSchema.parse({
    ...job.config,
    workflow: "character_swap",
    characterId: character.id,
    stylePreset: "custom",
    prompt: "Preserve the original performance.",
  });
  job.character = character;
  job.stage = "prompt_refinement";
  job.status = "processing";
  const canvas = renderToStaticMarkup(
    createElement(MediaCanvas, {
      source: job.source,
      job,
      start: 0,
      duration: 4,
      tab: null,
      onTab: noop,
    }),
  );
  assert.match(canvas, /Refining source subject/);
  job.samRefinement = refinementFixture(
    job.prepared!.id,
    "person",
    "person wearing black",
  );
  const props = {
    job,
    onApprove: noop,
    onReuse: noop,
    onCancel: noop,
    approving: false,
    cancelling: false,
    reuseDisabled: false,
  };
  const details = renderToStaticMarkup(createElement(RunDetails, props));
  assert.match(details, />Refine<\/li>/);
  assert.match(details, /Original source subject: person/);
  assert.match(details, /SAM description: person wearing black/);
  job.status = "needs_attention";
  const stopped = renderToStaticMarkup(createElement(RunDetails, props));
  assert.match(stopped, /AI subject refinement stopped before SAM/);
  assert.ok(!stopped.includes("submission wasn’t confirmed"));
  assert.ok(!stopped.includes("Approve &amp; create video"));
});

test("swap verification exposes its stage and a labeled synchronized mask-check video", () => {
  const job = reviewJob();
  const character = media();
  job.config = createJobSchema.parse({
    ...job.config,
    workflow: "character_swap",
    characterId: character.id,
    stylePreset: "custom",
    prompt: "Preserve the original performance.",
  });
  job.character = character;
  job.masked = media("masked");
  job.maskComparison = media("verification");
  job.stage = "mask_verification";
  job.status = "processing";
  const markup = renderToStaticMarkup(
    createElement(MediaCanvas, {
      source: job.source,
      job,
      start: 0,
      duration: 4,
      tab: "mask_comparison",
      onTab: noop,
    }),
  );
  assert.match(markup, /Mask Check/);
  assert.match(markup, /Verifying subject tracking/);
  assert.match(markup, /Original left, mask overlay right/);
  assert.match(markup, /Original and red SAM mask comparison/);
  job.status = "needs_attention";
  job.maskVerifications = [
    {
      ...verificationFixture(job.masked.id, job.maskComparison.id),
      decision: "needs_review",
      reason: "partial_mask",
    },
  ];
  const details = renderToStaticMarkup(
    createElement(RunDetails, {
      job,
      onApprove: noop,
      onReuse: noop,
      onCancel: noop,
      approving: false,
      cancelling: false,
      reuseDisabled: false,
    }),
  );
  assert.match(details, />Verify<\/li>/);
  assert.match(details, /AI mask verification stopped this take/);
  assert.match(details, /not frame-by-frame tracking or consent verification/);
  assert.ok(!details.includes("submission wasn’t confirmed"));
  assert.ok(!details.includes("Approve &amp; create video"));
});

test("the focusable clip slider thumb has its own accessible name and description", () => {
  const markup = renderToStaticMarkup(
    createElement(Slider, {
      "aria-label": "Select clip length",
      "aria-describedby": "clip-help",
      min: 4,
      max: 15,
      value: [6],
    }),
  );
  const thumb = markup.match(/<[^>]+role="slider"[^>]*>/)?.[0];
  assert.ok(thumb);
  assert.match(thumb, /aria-label="Select clip length"/);
  assert.match(thumb, /aria-describedby="clip-help"/);
  assert.match(thumb, /aria-valuemin="4"/);
  assert.match(thumb, /aria-valuemax="15"/);
});

test("a reusable range slider supports distinct thumb names", () => {
  const markup = renderToStaticMarkup(
    createElement(Slider, {
      thumbLabels: ["Range start", "Range end"],
      value: [4, 10],
    }),
  );
  const thumbs = markup.match(/<[^>]+role="slider"[^>]*>/g);
  assert.equal(thumbs?.length, 2);
  assert.match(thumbs![0], /aria-label="Range start"/);
  assert.match(thumbs![1], /aria-label="Range end"/);
});

test("workflow selectors have labels and expose only the operation or preset for their mode", () => {
  for (const workflow of [
    "character_swap",
    "element_edit",
    "motion_transfer",
    "restyle",
  ] as const) {
    const markup = renderToStaticMarkup(
      createElement(WorkflowControls, {
        workflow,
        operation: "modify",
        stylePreset: "custom",
        disabled: false,
        onWorkflow: noop,
        onOperation: noop,
        onStylePreset: noop,
      }),
    );
    assert.match(markup, /<label for="workflow">Workflow<\/label>/);
    assert.match(markup, /id="workflow"/);
    assert.equal(
      markup.includes('id="edit-operation"'),
      workflow === "element_edit",
    );
    assert.equal(markup.includes('id="style-preset"'), workflow === "restyle");
    if (workflow === "restyle") assert.match(markup, /value="pixel_art"/);
  }
});

test("ordered references label roles and reorder controls and disable boundary moves", () => {
  const references: Job["references"] = [
    { id: randomUUID(), role: "object", media: media() },
    { id: randomUUID(), role: "scene", media: media() },
  ];
  const markup = renderToStaticMarkup(
    createElement(ReferenceTray, {
      workflow: "element_edit",
      references,
      disabled: false,
      apiClient: api,
      onAdd: noop,
      onRemove: noop,
      onRole: noop,
      onMove: noop,
      onBusyChange: noop,
    }),
  );
  assert.match(markup, /aria-label="Ordered image references"/);
  assert.match(markup, /Image 1 role/);
  assert.match(markup, /Image 2 role/);
  assert.match(markup, /aria-label="Move Image 1 earlier" disabled/);
  assert.match(markup, /aria-label="Move Image 2 later" disabled/);
  assert.match(markup, /aria-label="Remove Image 1"/);
  assert.match(markup, /aria-label="Upload reference image"/);
});

test("image upload transport supports a reference-specific accessible label", () => {
  const markup = renderToStaticMarkup(
    createElement(UploadTile, {
      kind: "character",
      label: "Reference image",
      value: null,
      onChange: noop,
    }),
  );
  assert.match(markup, /aria-label="Choose reference image"/);
  assert.match(markup, /aria-label="Upload reference image"/);
});

test("new workflow review previews the prepared original rather than a missing subject mask", () => {
  const take = reviewJob();
  const markup = renderToStaticMarkup(
    createElement(MediaCanvas, {
      source: take.source,
      job: take,
      start: 0,
      duration: 4,
      tab: null,
      onTab: noop,
    }),
  );
  assert.match(markup, /aria-label="Prepared original video preview"/);
  assert.ok(markup.includes(`src="${take.prepared!.url}"`));
  assert.doesNotMatch(markup, />Subject<\/button>/);
  assert.match(markup, /aria-selected="true"[^>]*>[^<]*Prepared original/);
});

test("new workflow approval explains registration without inventing an authorization gate", () => {
  const take = reviewJob();
  const props = {
    job: take,
    onApprove: noop,
    onReuse: noop,
    onCancel: noop,
    approving: false,
    cancelling: false,
    reuseDisabled: false,
  };
  const markup = renderToStaticMarkup(createElement(RunDetails, props));
  assert.match(markup, /Review the prepared original clip/);
  assert.match(markup, /does not verify consent/);
  assert.doesNotMatch(markup, /Check the subject mask/);
  const button = markup.match(
    /<button[^>]*>[\s\S]*?Approve &amp; create video<\/button>/,
  )?.[0];
  assert.ok(button);
  assert.doesNotMatch(button, / disabled(?:=|\s|>)/);
  const unavailable = renderToStaticMarkup(
    createElement(RunDetails, {
      ...props,
      job: { ...take, prepared: null },
    }),
  );
  assert.match(
    unavailable,
    /<button[^>]* disabled=""[^>]*>[\s\S]*?Approve &amp; create video/,
  );
});

test("the library renders video-only takes without a character or poster and labels their workflow", () => {
  const markup = renderToStaticMarkup(
    createElement(Library, {
      jobs: [reviewJob()],
      loading: false,
      onRetry: noop,
      onSelect: noop,
      onNew: noop,
    }),
  );
  assert.match(markup, /Watercolor take/);
  assert.match(markup, /Restyle/);
  assert.match(markup, /Watercolor/);
  assert.match(markup, /take-no-poster/);
});
