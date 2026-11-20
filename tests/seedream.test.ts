import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SEEDREAM_NAME } from "../src/lib/branding";
import {
  DEFAULT_SEEDREAM_MODEL,
  seedreamModelLabel,
} from "../src/lib/image-models";
import {
  modelArk,
  ProviderError,
  seedreamRequest,
} from "../src/server/providers";
import { capabilitySchema } from "../src/lib/schemas";

const root = await mkdtemp(path.join(tmpdir(), "seedream-test-"));
const { env } = await import("../src/env");
Object.assign(env, { MEDIA_ROOT: root });
const { GET } = await import("../src/app/api/capabilities/route");
after(() => rm(root, { recursive: true, force: true }));
const preferredModel = "dola-seedream-5-5-261028";

test("the setup template and studio branding select the verified Seedream 5.5 release", async () => {
  assert.equal(SEEDREAM_NAME, "Seedream 5.5");
  assert.equal(DEFAULT_SEEDREAM_MODEL, preferredModel);
  const example = await readFile(".env.example", "utf8");
  assert.match(example, new RegExp(`^SEEDREAM_MODEL=${preferredModel}$`, "m"));
});

test("image model labels show configured overrides without presenting them as Seedream 5.5", () => {
  assert.equal(seedreamModelLabel(preferredModel), "Seedream 5.5");
  assert.equal(
    seedreamModelLabel("dola-seedream-5-0-pro-260628"),
    "Seedream 5.0 Pro",
  );
  for (const model of [undefined, null, ""])
    assert.equal(seedreamModelLabel(model), "Seedream 5.5");
  for (const model of [
    "ep-custom-image",
    "dola-seedream-5-5-unknown",
    "Seedream 5.5 · simulated",
  ])
    assert.equal(seedreamModelLabel(model), model);
});

test("scene preparation requests one opaque 2K JPEG with ordered references and no unsupported features", () => {
  for (const providerModel of [preferredModel, "ep-custom-image"]) {
    const request = seedreamRequest({
      providerModel,
      characterUrl: "https://example.com/character.jpg",
      frameUrl: "https://example.com/frame.jpg",
      target: "performer on the left",
      prompt: 'Keep the background and shirt text "Image 1".',
    });
    assert.equal(request.model, providerModel);
    assert.deepEqual(request.image, [
      "https://example.com/character.jpg",
      "https://example.com/frame.jpg",
    ]);
    assert.equal(request.size, "2K");
    assert.equal(request.output_format, "jpeg");
    assert.equal(request.background, "opaque");
    assert.equal(request.response_format, "url");
    assert.equal(request.watermark, true);
    for (const parameter of [
      "layer_decomposition",
      "sequential_image_generation",
      "tools",
      "negative_prompt",
      "optimize_prompt_options",
    ])
      assert.equal(parameter in request, false);
  }
});

test("capabilities retain exact image model pins and require both a model and ModelArk key", async () => {
  const original = {
    MEDIA_ROOT: env.MEDIA_ROOT,
    BYTEPLUS_API_KEY: env.BYTEPLUS_API_KEY,
    SEEDREAM_MODEL: env.SEEDREAM_MODEL,
  };
  try {
    for (const model of [
      preferredModel,
      "dola-seedream-5-0-pro-260628",
      "ep-custom-image",
      undefined,
    ]) {
      for (const key of [undefined, "fixture-model-key"]) {
        Object.assign(env, { SEEDREAM_MODEL: model, BYTEPLUS_API_KEY: key });
        const response = await GET(
          new Request(env.APP_URL + "/api/capabilities"),
        );
        assert.equal(response.status, 200);
        const capabilities = capabilitySchema.parse(await response.json());
        assert.equal(capabilities.seedreamModel, model ?? null);
        assert.equal(capabilities.image, !!model && !!key);
        assert.ok(
          capabilities.workflows.every(
            (workflow) => !workflow.qualityValidated,
          ),
        );
      }
    }
  } finally {
    Object.assign(env, original);
  }
});

test("ModelArk submits the exact Seedream 5.5 scene request once and reports rejected access without fallback", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = env.BYTEPLUS_API_KEY;
  const request = seedreamRequest({
    providerModel: preferredModel,
    characterUrl: "https://example.com/character.jpg",
    frameUrl: "https://example.com/frame.jpg",
    target: "performer on the left",
    prompt: "Keep the original scene.",
  });
  try {
    Object.assign(env, { BYTEPLUS_API_KEY: "fixture-model-key" });
    for (const status of [200, 403]) {
      let calls = 0;
      const result = { data: [{ url: "https://example.com/scene.jpg" }] };
      globalThis.fetch = async (url, init) => {
        calls++;
        assert.equal(url, env.BYTEPLUS_BASE_URL + "/images/generations");
        assert.equal(init?.method, "POST");
        assert.deepEqual(JSON.parse(String(init?.body)), request);
        return Response.json(
          status === 200 ? result : { error: { code: "ModelNotOpen" } },
          { status },
        );
      };
      if (status === 200)
        assert.deepEqual(
          await modelArk("/images/generations", request),
          result,
        );
      else
        await assert.rejects(
          modelArk("/images/generations", request),
          (error) => {
            assert.ok(error instanceof ProviderError);
            assert.equal(error.httpStatus, 403);
            assert.equal(error.ambiguous, false);
            assert.match(error.message, /ModelNotOpen/);
            return true;
          },
        );
      assert.equal(calls, 1);
    }
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(env, { BYTEPLUS_API_KEY: originalKey });
  }
});
