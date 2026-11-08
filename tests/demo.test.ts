import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceDemo, type DemoRecord } from "../src/server/demo/lifecycle";
import type { Upload, Job } from "../src/lib/schemas";
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
  const job: Job = {
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
  };
  return {
    job,
    scenario: "success",
    approvedAt: null,
    masked: { ...upload, kind: "masked" },
    anchor: { ...upload, kind: "anchor", mime: "image/jpeg" },
    result: { ...upload, kind: "result" },
  };
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
