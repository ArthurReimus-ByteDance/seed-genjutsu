import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createJobSchema } from "../src/lib/schemas";
import { transformationRequest } from "../src/server/generation";

function config(workflow: "element_edit" | "motion_transfer" | "restyle") {
  return createJobSchema.parse({
    workflow,
    model: "seedance-2.5",
    sourceId: randomUUID(),
    prompt: 'Change the sign to say "Open Today".',
    duration: 8,
    references:
      workflow === "motion_transfer"
        ? [{ id: randomUUID(), mediaId: randomUUID(), role: "character" }]
        : [],
  });
}

test("video-only edits preserve literal direction and use explicit editing semantics", () => {
  const body = transformationRequest({
    config: config("element_edit"),
    providerModel: "pinned-endpoint",
    videoUri: "asset://approved-source",
    references: [],
  });
  assert.equal(body.model, "pinned-endpoint");
  assert.equal(body.omni_reference_task_type, "edit");
  assert.equal(body.duration, -1);
  assert.equal(body.ratio, "adaptive");
  assert.equal(body.generate_audio, false);
  assert.equal(body.content.length, 2);
  assert.equal(body.content[1].video_url?.url, "asset://approved-source");
  assert.ok(
    body.content[0].text?.includes(
      JSON.stringify('Change the sign to say "Open Today".'),
    ),
  );
  assert.ok(!body.content[0].text?.includes("gray masked"));
});

test("motion transfer maps ordered cast references and uses reference generation with fixed duration", () => {
  const input = config("motion_transfer");
  input.references.push({
    id: randomUUID(),
    mediaId: randomUUID(),
    role: "scene",
  });
  const body = transformationRequest({
    config: input,
    providerModel: "pinned-endpoint",
    videoUri: "asset://motion",
    references: [
      { role: "character", url: "https://media.example/cast.jpg" },
      { role: "scene", url: "https://media.example/scene.jpg" },
    ],
  });
  assert.equal(body.omni_reference_task_type, "reference");
  assert.equal(body.duration, 8);
  assert.deepEqual(
    body.content.slice(2).map((entry) => entry.image_url?.url),
    ["https://media.example/cast.jpg", "https://media.example/scene.jpg"],
  );
  assert.ok(body.content[0].text?.includes("Image 1"));
  assert.ok(body.content[0].text?.includes("Image 2"));
  assert.ok(!body.content[0].text?.includes("gray masked"));
});

test("restyle resolves presets while preserving source composition and motion", () => {
  const input = config("restyle");
  input.stylePreset = "watercolor";
  input.prompt = "";
  input.preserveAudio = false;
  const body = transformationRequest({
    config: input,
    providerModel: "pinned-endpoint",
    videoUri: "asset://source",
    references: [],
  });
  assert.ok(body.content[0].text?.includes("watercolor"));
  assert.equal(body.omni_reference_task_type, "edit");
  assert.equal(body.generate_audio, true);
});

test("builders reject reference-count and role-order mismatches before submission", () => {
  const input = config("motion_transfer");
  assert.throws(
    () =>
      transformationRequest({
        config: input,
        providerModel: "endpoint",
        videoUri: "asset://source",
        references: [],
      }),
    /reference/i,
  );
  assert.throws(
    () =>
      transformationRequest({
        config: input,
        providerModel: "endpoint",
        videoUri: "asset://source",
        references: [{ role: "style", url: "https://media.example/style.jpg" }],
      }),
    /reference/i,
  );
});
