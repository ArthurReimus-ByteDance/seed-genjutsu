import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
nextEnv.loadEnvConfig(process.cwd());
const { env } = await import("../src/env");
const { jobSchema, uploadSchema } = await import("../src/lib/schemas");
const { promptEnhancementSchema } =
  await import("../src/lib/prompt-enhancement");
const base = process.argv[2] ?? env.APP_URL;
const run = promisify(execFile),
  observations: string[] = [];
function actor() {
  return {
    async req(endpoint: string, status: number, options: RequestInit = {}) {
      const headers = new Headers(options.headers);
      headers.set("Origin", new URL(env.APP_URL).origin);
      const response = await fetch(base + "/api/demo/" + endpoint, {
        ...options,
        headers,
        signal: AbortSignal.timeout(90000),
      });
      assert.equal(
        response.headers.get("set-cookie"),
        null,
        "Preview does not create login or session cookies",
      );
      assert.equal(response.status, status, endpoint + ": " + response.status);
      observations.push(
        (options.method ?? "GET") + " " + endpoint + " → " + status,
      );
      return response;
    },
    async json(
      endpoint: string,
      status: number,
      input?: unknown,
      scenario?: "success" | "failure",
    ) {
      return (
        await this.req(
          endpoint,
          status,
          input === undefined
            ? {}
            : {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(scenario ? { "X-Recast-Scenario": scenario } : {}),
                },
                body: JSON.stringify(input),
              },
        )
      ).json();
    },
  };
}
async function wait(c: ReturnType<typeof actor>, id: string, state: string) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const job = jobSchema.parse((await c.json("jobs/" + id, 200)).job);
    if (job.status === state) return job;
    if (["failed", "cancelled", "succeeded"].includes(job.status))
      throw new Error("Expected " + state + ", got " + job.status);
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  throw new Error("Preview did not reach " + state);
}
const temp = await mkdtemp(path.join(tmpdir(), "recast-preview-check-"));
try {
  for (const file of [
    "source.jpg",
    "character.jpg",
    "source.mp4",
    "result.mp4",
  ]) {
    const response = await fetch(base + "/samples/" + file);
    assert.equal(response.status, 200, "Sample asset " + file);
    assert.match(
      response.headers.get("content-type") ?? "",
      file.endsWith(".jpg") ? /^image\/jpeg/ : /^video\/mp4/,
    );
    assert.ok((await response.arrayBuffer()).byteLength > 1000);
    observations.push("Packaged sample " + file + " → 200");
  }
  const a = actor(),
    b = actor();
  const initial = await a.json("jobs", 200);
  const initialCount = initial.jobs.length;
  assert.equal((await a.json("capabilities", 200)).promptEnhancement, true);
  const enhanceInput = {
    prompt: "Make the performer a silver robot.",
    model: "seedance-2.5",
    target: "performer",
    prepareImage: false,
    preserveAudio: true,
  };
  const enhanced = promptEnhancementSchema.parse(
    (await a.json("prompts/enhance", 200, enhanceInput)).enhancement,
  );
  assert.equal(enhanced.simulated, true);
  assert.match(enhanced.prompt, /Video 1/);
  assert.match(enhanced.prompt, /Image 1/);
  assert.ok(!enhanced.prompt.includes("Image 2"));
  const alternate = promptEnhancementSchema.parse(
    (
      await a.json("prompts/enhance", 200, {
        ...enhanceInput,
        previousPrompt: enhanced.prompt,
      })
    ).enhancement,
  );
  assert.notEqual(alternate.prompt, enhanced.prompt);
  assert.ok(alternate.prompt.includes(enhanceInput.prompt));
  await a.json("prompts/enhance", 502, enhanceInput, "failure");
  await a.json("prompts/enhance", 400, { ...enhanceInput, prompt: " " });
  const refs = await a.json("samples", 200, {});
  const source = uploadSchema.parse(refs.source),
    character = uploadSchema.parse(refs.character);
  await b.req("media/" + source.id, 200);
  const live = await fetch(base + "/api/media/" + source.id);
  assert.equal(live.status, 404);
  observations.push(
    "Preview media stays outside the real studio index; a fresh client needs no cookie",
  );
  const range = await a.req("media/" + source.id, 206, {
    headers: { Range: "bytes=0-99" },
  });
  assert.equal((await range.arrayBuffer()).byteLength, 100);
  const invalid = new FormData();
  invalid.set("kind", "video");
  invalid.set(
    "file",
    new File(["not a video"], "invalid.mp4", { type: "video/mp4" }),
  );
  await a.req("uploads", 400, { method: "POST", body: invalid });
  const imageForm = new FormData();
  imageForm.set("kind", "character");
  imageForm.set(
    "file",
    new File(
      [await readFile("public/samples/character.jpg")],
      "character.jpg",
      { type: "image/jpeg" },
    ),
  );
  const uploaded = uploadSchema.parse(
    (
      await (
        await a.req("uploads", 201, { method: "POST", body: imageForm })
      ).json()
    ).upload,
  );
  assert.equal(uploaded.kind, "character");
  const input = {
    sourceId: source.id,
    characterId: character.id,
    prompt: enhanced.prompt,
    model: "seedance-2.5",
    target: "dancer",
    start: 1,
    duration: 4,
    resolution: "480p",
    prepareImage: true,
    preserveAudio: true,
  };
  await a.json("jobs", 400, { ...input, start: 5 });
  const created = jobSchema.parse((await a.json("jobs", 202, input)).job);
  assert.equal(created.prompt, enhanced.prompt);
  await b.json("jobs/" + created.id, 200);
  await a.json("jobs/" + created.id + "/approve", 409, {});
  const review = await wait(a, created.id, "awaiting_approval");
  assert.ok(review.masked);
  assert.ok(review.anchor);
  assert.equal(review.result, null);
  const persisted = jobSchema.parse(
    (await a.json("jobs/" + created.id, 200)).job,
  );
  assert.equal(persisted.status, "awaiting_approval");
  assert.equal(persisted.prompt, enhanced.prompt);
  await a.json("jobs/" + created.id + "/approve", 200, {});
  await a.json("jobs/" + created.id + "/approve", 409, {});
  const ready = await wait(a, created.id, "succeeded");
  assert.ok(ready.result);
  const download = await a.req(
    "media/" + ready.result!.id + "?download=1",
    200,
  );
  assert.match(download.headers.get("content-disposition") ?? "", /attachment/);
  const file = path.join(temp, "result.mp4");
  await writeFile(file, Buffer.from(await download.arrayBuffer()));
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "json",
    file,
  ]);
  assert.ok(Math.abs(Number(JSON.parse(stdout).format.duration) - 4) < 0.1);
  observations.push("Completed sample download is a readable four-second MP4");
  const failedJob = jobSchema.parse(
    (await a.json("jobs", 202, { ...input, prepareImage: false }, "failure"))
      .job,
  );
  await wait(a, failedJob.id, "awaiting_approval");
  await a.json("jobs/" + failedJob.id + "/approve", 200, {});
  const failed = await wait(a, failedJob.id, "failed");
  assert.equal(failed.result, null);
  assert.ok(failed.error);
  const cancelled = jobSchema.parse((await a.json("jobs", 202, input)).job);
  await a.json("jobs/" + cancelled.id + "/cancel", 200, {});
  assert.equal(
    jobSchema.parse((await a.json("jobs/" + cancelled.id, 200)).job).status,
    "cancelled",
  );
  const history = await a.json("jobs", 200);
  assert.equal(history.jobs.length, initialCount + 3);
  const foreign = await fetch(base + "/api/demo/samples", {
    method: "POST",
    headers: { Origin: "https://untrusted.example" },
  });
  assert.equal(foreign.status, 403);
  await mkdir("output", { recursive: true });
  await writeFile(
    "output/demo-smoke-results.json",
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        base,
        observations,
        scope: "Mock APIs and local sample media only. No model calls.",
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: preview success, review gate, optional scene branch, failure, cancellation, separate local workspace, uploads and four-second download; no providers called.",
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
