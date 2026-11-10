import test from "node:test";
import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { once } from "node:events";
import { enhancePromptRequestSchema } from "../src/lib/prompt-enhancement";

// A real AI SDK provider talks only to this loopback fixture, never a hosted model.
process.env.BYTEPLUS_API_KEY = "unit-fixture";
const { enhancementInput, createPromptModel, enhancePrompt } =
  await import("../src/server/prompt-enhancement");
const { demoEnhancement } =
  await import("../src/server/demo/prompt-enhancement");
const input = enhancePromptRequestSchema.parse({
  prompt: "Make the performer a silver robot. Keep the original outfit.",
  model: "seedance-2",
  target: "performer",
  prepareImage: false,
  preserveAudio: true,
});
const prompt =
  "Recreate the performance from Video 1 with the silver robot from Image 1. Keep the original outfit and source motion, lighting, camera and scene.";
const modelId = "deepseek-v4-1-flash-261017";
const completion = (
  content: unknown = { prompt },
  finish = "stop",
  refusal: string | null = null,
) => ({
  id: "chatcmpl-fixture",
  object: "chat.completion",
  created: 1,
  model: modelId,
  choices: [
    {
      index: 0,
      finish_reason: finish,
      message: {
        role: "assistant",
        content: content === null ? null : JSON.stringify(content),
        refusal,
      },
    },
  ],
  usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 },
});
type Request = {
  url?: string;
  authorization?: string;
  body: Record<string, unknown>;
};
type Reply = { status?: number; body: unknown };
async function fixture(
  respond: (call: Request, index: number) => Promise<Reply> | Reply,
  run: (
    model: ReturnType<typeof createPromptModel>,
    calls: Request[],
  ) => Promise<void>,
) {
  const calls: Request[] = [];
  let failure: unknown;
  const server = createServer(
    (request: IncomingMessage, response: ServerResponse) => {
      void (async () => {
        let text = "";
        for await (const chunk of request) text += chunk;
        const call = {
          url: request.url,
          authorization: request.headers.authorization,
          body: JSON.parse(text),
        };
        calls.push(call);
        const reply = await respond(call, calls.length);
        if (!response.destroyed) {
          response.writeHead(reply.status ?? 200, {
            "Content-Type": "application/json",
          });
          response.end(JSON.stringify(reply.body));
        }
      })().catch((error) => {
        failure = error;
        response.writeHead(500).end();
      });
    },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const model = createPromptModel({
    baseURL: `http://127.0.0.1:${address.port}`,
    apiKey: "unit-fixture",
    modelId,
  });
  try {
    await run(model, calls);
    if (failure) throw failure;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
const code = (expected: string) => (error: unknown) =>
  (error as { code?: string }).code === expected;

test("AI SDK sends BytePlus DeepSeek the exact model, disabled thinking and JSON schema without reference media", async () => {
  await fixture(
    () => ({ body: completion() }),
    async (model, calls) => {
      for (const [videoModel, mode] of [
        ["seedance-2", "reference generation"],
        ["seedance-2.5", "video editing"],
      ] as const) {
        const result = await enhancePrompt(
          { ...input, model: videoModel },
          undefined,
          model,
        );
        assert.equal(result.prompt, prompt);
        assert.equal(result.simulated, false);
        const call = calls.at(-1)!;
        assert.equal(call.url, "/chat/completions");
        assert.equal(call.authorization, "Bearer unit-fixture");
        assert.equal(call.body.model, modelId);
        assert.equal(call.body.max_tokens, 1000);
        assert.deepEqual(call.body.thinking, { type: "disabled" });
        const format = call.body.response_format as {
          type: string;
          json_schema: { strict: boolean };
        };
        assert.equal(format.type, "json_schema");
        assert.equal(format.json_schema.strict, true);
        const messages = call.body.messages as {
          role: string;
          content: string;
        }[];
        const context = JSON.parse(
          messages.find((message) => message.role === "user")!.content,
        );
        assert.equal(context.originalDirection, input.prompt);
        assert.equal(context.generationMode, mode);
        assert.ok(
          messages.every((message) => typeof message.content === "string"),
        );
        assert.equal(
          "image" in call.body || "video" in call.body || "tools" in call.body,
          false,
        );
      }
      assert.equal(calls.length, 2);
    },
  );
});

test("retry retains original intent separately from previous wording and rejects media fields", () => {
  const context = JSON.parse(
    enhancementInput({ ...input, previousPrompt: prompt, prepareImage: true })
      .prompt,
  );
  assert.equal(context.originalDirection, input.prompt);
  assert.equal(context.previousSuggestion, prompt);
  assert.equal(context.scenePreparation, true);
  assert.throws(() =>
    enhancePromptRequestSchema.parse({
      ...input,
      imageUrl: "https://example.com/private.jpg",
    }),
  );
  assert.throws(() =>
    enhancePromptRequestSchema.parse({
      ...input,
      prompt: " ",
      model: "unknown",
    }),
  );
});

test("new workflows send semantic context without silhouette or invented image references", () => {
  for (const workflow of [
    "element_edit",
    "motion_transfer",
    "restyle",
  ] as const) {
    const request = enhancePromptRequestSchema.parse({
      ...input,
      workflow,
      model: "seedance-2.5",
      operation: "modify",
      stylePreset: workflow === "restyle" ? "watercolor" : "custom",
      references: workflow === "motion_transfer" ? [{ role: "scene" }] : [],
    });
    const prepared = enhancementInput(request);
    const context = JSON.parse(prepared.prompt);
    assert.equal(context.workflow, workflow);
    assert.equal(
      context.generationMode,
      workflow === "motion_transfer" ? "reference generation" : "video editing",
    );
    assert.equal(prepared.system.includes("neutral-gray silhouette"), false);
    assert.equal(
      context.references.length,
      workflow === "motion_transfer" ? 1 : 0,
    );
    if (workflow === "restyle")
      assert.ok(context.styleDirection.includes("watercolor"));
  }
});

test("preview enhancement for new modes stays mode-aware and retries without inventing Image 1", () => {
  for (const workflow of ["element_edit", "restyle"] as const) {
    const request = { ...input, workflow, model: "seedance-2.5" };
    const first = demoEnhancement(request, null);
    const retry = demoEnhancement(
      { ...request, previousPrompt: first.prompt },
      null,
    );
    assert.equal(first.simulated, true);
    assert.ok(!first.prompt.includes("Image 1"));
    assert.ok(!first.prompt.includes("masked"));
    assert.notEqual(retry.prompt, first.prompt);
  }
});

test("AI SDK and editorial validation reject incomplete, refused, malformed and oversized suggestions", async () => {
  let reply: unknown = completion({ prompt, additionalProperties: false });
  await fixture(
    () => ({ body: reply }),
    async (model, calls) => {
      assert.equal(
        (await enhancePrompt(input, undefined, model)).prompt,
        prompt,
      );
      for (const invalid of [
        completion({ prompt }, "length"),
        completion(null, "content_filter", "refused"),
        completion({ prompt: "" }),
        completion({ prompt: "x".repeat(3001) }),
        {
          ...completion(),
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: "invalid json" },
            },
          ],
        },
      ]) {
        reply = invalid;
        const before = calls.length;
        await assert.rejects(
          enhancePrompt(input, undefined, model),
          code("PROMPT_OUTPUT"),
        );
        assert.equal(calls.length, before + 1);
      }
    },
  );
});

test("a concurrent click cannot submit twice and an aborted SDK call releases the local slot", async () => {
  let release!: () => void;
  let seen!: () => void;
  const observed = new Promise<void>((resolve) => {
    seen = resolve;
  });
  await fixture(
    async (_call, index) => {
      if (index === 1) {
        seen();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return { body: completion() };
    },
    async (model, calls) => {
      const abort = new AbortController();
      const pending = enhancePrompt(input, abort.signal, model);
      await observed;
      await assert.rejects(
        enhancePrompt(input, undefined, model),
        code("PROMPT_BUSY"),
      );
      abort.abort();
      await assert.rejects(pending, code("PROMPT_CANCELLED"));
      release();
      assert.equal(calls.length, 1);
      assert.equal(
        (await enhancePrompt(input, undefined, model)).prompt,
        prompt,
      );
      assert.equal(calls.length, 2);
    },
  );
});

test("AI SDK failures make one HTTP attempt and never expose provider response details", async () => {
  let status = 401;
  await fixture(
    () => ({
      status,
      body: {
        error: {
          message: "raw private provider detail",
          type: "provider_error",
          ...(status === 404 ? { code: "ModelNotOpen" } : {}),
        },
      },
    }),
    async (model, calls) => {
      for (const nextStatus of [401, 404, 429, 500]) {
        status = nextStatus;
        const before = calls.length;
        await assert.rejects(
          enhancePrompt(input, undefined, model),
          (error: unknown) => {
            const issue = error as {
              code?: string;
              status?: number;
              message?: string;
            };
            return (
              issue.code ===
                (status === 404 ? "PROMPT_MODEL_ACCESS" : "PROMPT_PROVIDER") &&
              issue.status ===
                (status === 404 ? 503 : status === 429 ? 429 : 502) &&
              !issue.message?.includes("raw private")
            );
          },
        );
        assert.equal(calls.length, before + 1);
      }
    },
  );
});

test("an identical retry is reported without another hidden SDK request", async () => {
  await fixture(
    () => ({ body: completion() }),
    async (model, calls) => {
      await assert.rejects(
        enhancePrompt({ ...input, previousPrompt: prompt }, undefined, model),
        code("PROMPT_UNCHANGED"),
      );
      assert.equal(calls.length, 1);
    },
  );
});
