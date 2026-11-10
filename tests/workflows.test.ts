import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createJobSchema, savedJobConfigSchema } from "../src/lib/schemas";

const legacy = {
  sourceId: randomUUID(),
  characterId: randomUUID(),
  prompt: "Replace the dancer with the reference character.",
  duration: 4,
};
const reference = (role = "character") => ({
  id: randomUUID(),
  mediaId: randomUUID(),
  role,
});
const request = (workflow: string) => ({
  sourceId: legacy.sourceId,
  workflow,
  model: "seedance-2.5",
  prompt: "Transform the selected clip as directed.",
  duration: 4,
});

test("legacy takes keep character-swap routing and their model defaults", () => {
  assert.equal(createJobSchema.parse(legacy).workflow, "character_swap");
  assert.equal(createJobSchema.parse(legacy).model, "seedance-2");
  assert.equal(savedJobConfigSchema.parse(legacy).model, "seedance-2.5");
  assert.equal(
    createJobSchema.safeParse({ ...legacy, characterId: undefined }).success,
    false,
  );
});

test("element editing and restyling accept video-only direction", () => {
  for (const workflow of ["element_edit", "restyle"]) {
    const result = createJobSchema.parse(request(workflow));
    assert.equal(result.workflow, workflow);
    assert.deepEqual(result.references, []);
  }
});

test("motion transfer requires a cast or scene image and preserves image order", () => {
  assert.equal(
    createJobSchema.safeParse(request("motion_transfer")).success,
    false,
  );
  const references = [reference("scene"), reference("character")];
  assert.deepEqual(
    createJobSchema.parse({ ...request("motion_transfer"), references })
      .references,
    references,
  );
  assert.equal(
    createJobSchema.safeParse({
      ...request("motion_transfer"),
      references: [reference("style")],
    }).success,
    false,
  );
});

test("new workflows reject wrong models, unknown modes, duplicate references and excess images", () => {
  assert.equal(
    createJobSchema.safeParse({ ...request("restyle"), model: "seedance-2" })
      .success,
    false,
  );
  assert.equal(
    createJobSchema.safeParse({ ...legacy, workflow: "unknown" }).success,
    false,
  );
  const image = reference();
  assert.equal(
    createJobSchema.safeParse({
      ...request("restyle"),
      references: [image, image],
    }).success,
    false,
  );
  assert.equal(
    createJobSchema.safeParse({
      ...request("restyle"),
      references: Array.from({ length: 30 }, () => reference("style")),
    }).success,
    true,
  );
  assert.equal(
    createJobSchema.safeParse({
      ...request("restyle"),
      references: Array.from({ length: 31 }, () => reference("style")),
    }).success,
    false,
  );
  assert.equal(
    createJobSchema.safeParse({
      ...request("restyle"),
      references: [reference("invalid")],
    }).success,
    false,
  );
});

test("new workflows reject unsupported scene preparation and stale presets", () => {
  assert.equal(
    createJobSchema.safeParse({ ...request("restyle"), prepareImage: true })
      .success,
    false,
  );
  assert.equal(
    createJobSchema.safeParse({ ...request("restyle"), stylePreset: "missing" })
      .success,
    false,
  );
  assert.equal(
    createJobSchema.safeParse({ ...request("restyle"), stylePresetRevision: 2 })
      .success,
    false,
  );
  assert.equal(
    createJobSchema.safeParse({
      ...request("restyle"),
      stylePreset: "watercolor",
      prompt: "",
    }).success,
    true,
  );
  assert.equal(
    createJobSchema.safeParse({
      ...request("restyle"),
      prompt: "",
      references: [reference("style")],
    }).success,
    true,
  );
  assert.equal(
    createJobSchema.safeParse({
      ...request("restyle"),
      stylePreset: "custom",
      prompt: "",
    }).success,
    false,
  );
});

test("new-mode payloads reject unsupported fields while legacy callers retain stripping behavior", () => {
  assert.equal(
    createJobSchema.safeParse({
      ...request("element_edit"),
      maskUrl: "https://example.com/mask.png",
    }).success,
    false,
  );
  assert.equal(
    createJobSchema.safeParse({ ...legacy, legacyMetadata: "unused" }).success,
    true,
  );
});
