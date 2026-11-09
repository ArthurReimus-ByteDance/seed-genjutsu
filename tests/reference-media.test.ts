import assert from "node:assert/strict";
import test from "node:test";
import {
  validateSourceVideo,
  validateReferenceImage,
  validateReferenceVideo,
} from "../src/server/reference-media";
import type { Upload } from "../src/lib/schemas";

const media: Upload = {
  id: "bb0e613b-ac6f-4e57-a114-0614e5c82b1d",
  kind: "video",
  name: "input.mp4",
  mime: "video/mp4",
  bytes: 100_000,
  width: 1280,
  height: 720,
  duration: 6,
  url: "/api/media/input",
  posterUrl: null,
};

test("raw source clips can be normalized from extreme aspect ratios", () => {
  for (const [width, height] of [
    [1920, 300],
    [300, 1920],
  ]) {
    assert.doesNotThrow(() =>
      validateSourceVideo({ ...media, width, height }, 0, 4),
    );
  }
});

test("prepared provider videos enforce kind, ratio, size, dimensions, and finite duration", () => {
  const prepared = { ...media, kind: "prepared" as const, duration: 4 };
  assert.doesNotThrow(() => validateReferenceVideo(prepared, "prepared", 4));
  for (const change of [
    { kind: "masked" as const },
    { width: 1920, height: 300 },
    { bytes: 201 * 1024 * 1024 },
    { duration: Number.NaN },
    { duration: null },
    { duration: 3 },
  ]) {
    assert.throws(() =>
      validateReferenceVideo({ ...prepared, ...change }, "prepared", 4),
    );
  }
});

test("image references reject invalid metadata and the maximum file-size boundary", () => {
  const image = {
    ...media,
    kind: "character" as const,
    duration: null,
    mime: "image/jpeg",
  };
  assert.doesNotThrow(() => validateReferenceImage(image, "character"));
  assert.throws(() =>
    validateReferenceImage({ ...image, width: 0 }, "character"),
  );
  assert.throws(() =>
    validateReferenceImage({ ...image, bytes: 30 * 1024 * 1024 }, "character"),
  );
  assert.throws(() =>
    validateReferenceImage({ ...image, kind: "video" }, "character"),
  );
});

test("source videos reject missing duration, invalid metadata, and ranges past the clip", () => {
  assert.throws(() => validateSourceVideo({ ...media, duration: null }, 0, 4));
  assert.throws(() => validateSourceVideo({ ...media, bytes: -1 }, 0, 4));
  assert.throws(() =>
    validateSourceVideo({ ...media, width: 36_000_001 }, 0, 4),
  );
  assert.throws(() => validateSourceVideo(media, 3, 4));
});
