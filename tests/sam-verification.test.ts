import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { maskLine } from "../scripts/fixtures/meta-sam";
import { parseSavedMasks, samCheckpointStore } from "../src/server/meta-sam";
import { analyzeMasks, renderMaskedVideo } from "../src/server/sam-render";
import { resolveMaskReview } from "../src/lib/sam-verification";
import { refineSamPrompt, verifySamVideo } from "../src/server/sam-review";
import { ProviderError } from "../src/server/providers";

const geometry = { width: 96, height: 64, count: 96 };
const pass = {
  decision: "pass",
  reason: "matched",
  subjectIdentified: true,
  description: null,
} as const;
const input = {
  model: "deepseek-v4-1-flash-261017",
  videoUrl: "https://fixture.example/comparison.mp4",
  originalTarget: "the dancer",
  target: "person in black",
  analysis: {
    objects: 1,
    maskedFrames: 1,
    totalFrames: 96,
    foregroundPixels: 400,
    minConfidence: null,
    issue: null,
  },
};
const completion = (content: unknown = pass, finish = "stop") => ({
  id: "verifier-fixture",
  choices: [
    { finish_reason: finish, message: { content: JSON.stringify(content) } },
  ],
  usage: { prompt_tokens: 120, completion_tokens: 40 },
});

test("pre-SAM refinement sends source video and original intent without mask or replacement context", async () => {
  let calls = 0;
  const refined = {
    decision: "ready",
    reason: "identified",
    description: "person in a black sleeveless shirt",
  };
  const result = await refineSamPrompt(
    {
      model: input.model,
      videoUrl: input.videoUrl,
      originalTarget: "the dancer",
    },
    undefined,
    async (endpoint, body) => {
      calls++;
      assert.equal(endpoint, "/chat/completions");
      assert.equal(body!.model, input.model);
      assert.deepEqual(body!.thinking, { type: "disabled" });
      const messages = body!.messages as {
        role: string;
        content: { type: string; text?: string; video_url?: unknown }[];
      }[];
      const content = messages.find(
        (message) => message.role === "user",
      )!.content;
      assert.deepEqual(JSON.parse(content[0].text!), {
        originalTarget: "the dancer",
      });
      assert.deepEqual(content[1].video_url, { url: input.videoUrl, fps: 2 });
      assert.ok(!JSON.stringify(body).includes("deterministicMaskAnalysis"));
      return completion(refined);
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(result.refinement, refined);
  assert.equal(result.inputTokens, 120);
});

test("pre-SAM refinement rejects unsafe malformed or truncated output without extra requests", async () => {
  for (const content of [
    null,
    { decision: "ready", reason: "identified", description: "" },
    { decision: "ready", reason: "identified", description: "x".repeat(161) },
    {
      decision: "ready",
      reason: "identified",
      description: "HTTPS://private.example",
    },
    { decision: "ready", reason: "identified", description: "<instruction>" },
    { decision: "unknown", reason: "identified", description: "person" },
  ]) {
    let calls = 0;
    await assert.rejects(
      refineSamPrompt(input, undefined, async () => {
        calls++;
        return completion(content);
      }),
      ProviderError,
    );
    assert.equal(calls, 1);
  }
  await assert.rejects(
    refineSamPrompt(input, undefined, async () =>
      completion(
        { decision: "ready", reason: "identified", description: "person" },
        "length",
      ),
    ),
    ProviderError,
  );
});

test("pre-SAM refinement preserves ambiguous decisions sanitizes failures and respects cancellation", async () => {
  const refinement = {
    decision: "needs_review",
    reason: "ambiguous_subject",
    description: null,
  };
  assert.deepEqual(
    (
      await refineSamPrompt(input, undefined, async () =>
        completion(refinement),
      )
    ).refinement,
    refinement,
  );
  for (const status of [401, 429, 500]) {
    let calls = 0;
    await assert.rejects(
      refineSamPrompt(input, undefined, async () => {
        calls++;
        throw new ProviderError(
          "private-url-and-body",
          status >= 500,
          true,
          status,
        );
      }),
      (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        assert.equal(error.retryable, false);
        assert.ok(!error.message.includes("private-url-and-body"));
        return true;
      },
    );
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(
    refineSamPrompt(input, AbortSignal.abort(), async () => {
      calls++;
      return completion();
    }),
  );
  assert.equal(calls, 0);
});

test("mask analysis distinguishes empty masks and multiple objects and keeps latest frame revisions", () => {
  assert.equal(analyzeMasks(parseSavedMasks(""), geometry).issue, "empty_mask");
  assert.equal(
    analyzeMasks(
      parseSavedMasks(maskLine(0) + maskLine(1, 96, 64, 8)),
      geometry,
    ).issue,
    "multiple_subjects",
  );
  const revised = analyzeMasks(
    parseSavedMasks(maskLine(0) + maskLine(0, 96, 64, 7, 50)),
    geometry,
  );
  assert.equal(revised.maskedFrames, 1);
  assert.equal(revised.foregroundPixels, 400);
  assert.equal(revised.minConfidence, null);
  assert.equal(revised.issue, null);
});

test("omitted frames are evidence rather than automatic tracking failures and invalid masks stop", () => {
  assert.equal(
    analyzeMasks(parseSavedMasks(maskLine(2) + maskLine(50)), geometry).issue,
    null,
  );
  assert.throws(
    () => analyzeMasks(parseSavedMasks(maskLine(96)), geometry),
    ProviderError,
  );
  assert.throws(
    () => analyzeMasks(parseSavedMasks("<0f>bad\n"), geometry),
    ProviderError,
  );
  assert.throws(
    () => analyzeMasks(parseSavedMasks(maskLine()), { ...geometry, count: 0 }),
    ProviderError,
  );
  assert.throws(
    () => analyzeMasks(parseSavedMasks(maskLine()), { ...geometry, width: 10 }),
    ProviderError,
  );
});

test("review cannot approve unusable masks change subjects or exceed one corrective SAM retry", () => {
  const empty = {
    ...input.analysis,
    issue: "empty_mask" as const,
    objects: 0,
    foregroundPixels: 0,
  };
  const retry = {
    decision: "retry",
    reason: "empty_mask",
    subjectIdentified: true,
    description: "person in a black sleeveless shirt",
  } as const;
  assert.equal(resolveMaskReview(pass, empty, "person", 0), "stop");
  assert.equal(resolveMaskReview(retry, empty, "person", 0), "retry");
  assert.equal(resolveMaskReview(retry, empty, "person", 1), "stop");
  assert.equal(resolveMaskReview(retry, empty, retry.description, 0), "stop");
  assert.equal(
    resolveMaskReview(
      { ...retry, subjectIdentified: false },
      empty,
      "person",
      0,
    ),
    "stop",
  );
  assert.equal(
    resolveMaskReview(
      { ...retry, reason: "partial_mask" },
      input.analysis,
      "person",
      0,
    ),
    "stop",
  );
  assert.equal(resolveMaskReview(pass, input.analysis, "person", 0), "pass");
});

test("video verifier sends native video input strict JSON and no thinking in one request", async () => {
  let calls = 0;
  const result = await verifySamVideo(
    input,
    undefined,
    async (endpoint, body) => {
      calls++;
      assert.equal(endpoint, "/chat/completions");
      assert.equal(body!.model, input.model);
      assert.deepEqual(body!.thinking, { type: "disabled" });
      assert.equal(body!.max_tokens, 600);
      const format = body!.response_format as {
        type: string;
        json_schema: { strict: boolean };
      };
      assert.equal(format.type, "json_schema");
      assert.equal(format.json_schema.strict, true);
      const messages = body!.messages as {
        role: string;
        content: { type: string; video_url?: { url: string; fps: number } }[];
      }[];
      const video = messages
        .find((message) => message.role === "user")!
        .content.find((part) => part.type === "video_url");
      assert.deepEqual(video?.video_url, { url: input.videoUrl, fps: 2 });
      return completion();
    },
  );
  assert.equal(calls, 1);
  assert.deepEqual(result.review, pass);
  assert.equal(result.inputTokens, 120);
});

test("invalid truncated and unsafe verifier output never triggers hidden retries", async () => {
  for (const content of [
    { ...pass, decision: "unknown" },
    { ...pass, subjectIdentified: "true" },
    { ...pass, description: "https://private.example/?token=secret" },
    { ...pass, description: "x".repeat(161) },
    { ...pass, description: "" },
    null,
  ]) {
    let calls = 0;
    await assert.rejects(
      verifySamVideo(input, undefined, async () => {
        calls++;
        return completion(content);
      }),
      ProviderError,
    );
    assert.equal(calls, 1);
  }
  await assert.rejects(
    verifySamVideo(input, undefined, async () => completion(pass, "length")),
    ProviderError,
  );
});

test("verifier errors never auto retry and cancellation prevents the request", async () => {
  for (const status of [401, 429, 500]) {
    let calls = 0;
    await assert.rejects(
      verifySamVideo(input, undefined, async () => {
        calls++;
        throw new ProviderError(
          "private-body https://secret.example",
          status >= 500,
          status === 429,
          status,
        );
      }),
      (error: unknown) => {
        assert.ok(error instanceof ProviderError);
        assert.equal(error.retryable, false);
        assert.equal(error.ambiguous, status >= 500);
        assert.ok(!error.message.includes("private-body"));
        assert.ok(!error.message.includes("https://secret"));
        return true;
      },
    );
    assert.equal(calls, 1);
  }
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(
    verifySamVideo(input, controller.signal, async () => {
      calls++;
      return completion();
    }),
  );
  assert.equal(calls, 0);
});

test("comparison video stays synchronized silent and bounded and supports reviewing empty masks", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "seed-comparison-test-"));
  try {
    const source = path.join(dir, "source.mp4");
    await promisify(execFile)("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=blue:s=96x64:r=24:d=4",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      source,
    ]);
    for (const output of [
      maskLine(),
      "",
      maskLine(0) + maskLine(1, 96, 64, 8),
    ]) {
      const rendered = await renderMaskedVideo(
        source,
        parseSavedMasks(output),
        undefined,
        true,
      );
      try {
        assert.ok(rendered.comparison);
        assert.equal(rendered.comparison.meta.width, 192);
        assert.equal(rendered.comparison.meta.height, 64);
        assert.equal(rendered.comparison.meta.hasAudio, false);
        assert.ok(Math.abs(rendered.comparison.meta.duration - 4) < 0.05);
        assert.ok(rendered.comparison.data.length < 50_000_000);
      } finally {
        await rm(rendered.dir, { recursive: true, force: true });
      }
    }
    const first = samCheckpointStore(
      "aabbccdd-1234-4567-8901-123456789012",
      dir,
    );
    const retry = samCheckpointStore(
      "aabbccdd-1234-4567-8901-123456789012",
      dir,
      1,
    );
    await first.update((state) => {
      state.response = { responseId: "original", output: "" };
    });
    assert.equal(await retry.read((state) => state.response), null);
    assert.equal(
      await first.read((state) => state.response?.responseId),
      "original",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
