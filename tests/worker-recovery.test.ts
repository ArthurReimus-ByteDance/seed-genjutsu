import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJobSchema, type CreateJob } from "../src/lib/schemas";

const root = await mkdtemp(path.join(tmpdir(), "seed-recovery-"));
const project = fileURLToPath(new URL("..", import.meta.url));
process.env.MEDIA_ROOT = root;
process.env.STORAGE_MODE = "tos";
process.env.TOS_BUCKET = "fixture-bucket";
process.env.BYTEPLUS_ACCESS_KEY = "fixture-access";
process.env.BYTEPLUS_SECRET_KEY = "fixture-secret";
const { workspace } = await import("../src/server/workspace");
const { createJob, updateJob, jobRecord } = await import("../src/server/jobs");
after(() => rm(root, { recursive: true, force: true }));

async function createFixture(
  workflow: CreateJob["workflow"] = "character_swap",
) {
  const sourceId = randomUUID(),
    characterId = randomUUID();
  await workspace.update((state) => {
    state.jobs = {};
    state.media = {};
    state.assetGroupId = null;
    for (const [id, kind] of [
      [sourceId, "video"],
      [characterId, "character"],
    ] as const) {
      state.media[id] = {
        id,
        kind,
        name: "fixture",
        mime: kind === "video" ? "video/mp4" : "image/jpeg",
        bytes: 1,
        width: kind === "video" ? 1280 : 600,
        height: kind === "video" ? 720 : 600,
        duration: kind === "video" ? 4 : null,
        storage_key: "fixture/" + id,
        poster_id: null,
      };
    }
  });
  return createJob(
    createJobSchema.parse({
      sourceId,
      workflow,
      model: "seedance-2.5",
      characterId: workflow === "character_swap" ? characterId : undefined,
      references:
        workflow === "motion_transfer"
          ? [{ id: randomUUID(), mediaId: characterId, role: "character" }]
          : [],
      prompt: "Synthetic recovery validation",
      duration: 4,
    }),
  );
}

async function runWorker(jobId: string, expected: string, preload: string) {
  const child = spawn(
    process.execPath,
    [
      "--import",
      path.join(project, "node_modules/tsx/dist/loader.mjs"),
      "--import",
      "data:text/javascript," + encodeURIComponent(preload),
      path.join(project, "scripts/worker.ts"),
    ],
    {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "production",
        MEDIA_ROOT: root,
        STORAGE_MODE: "tos",
        TOS_BUCKET: "fixture-bucket",
        BYTEPLUS_ACCESS_KEY: "fixture-access",
        BYTEPLUS_SECRET_KEY: "fixture-secret",
        BYTEPLUS_API_KEY: "fixture-model-key",
        BYTEPLUS_SESSION_TOKEN: "",
        META_API_KEY: "",
        WORKER_POLL_MS: "500",
        TSX_TSCONFIG_PATH: path.join(project, "tsconfig.json"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    const deadline = Date.now() + 10000;
    let saved = await jobRecord(jobId);
    while (
      saved.stage !== expected &&
      saved.status !== expected &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      saved = await jobRecord(jobId);
      if (["failed", "needs_attention", "cancelled"].includes(saved.status))
        break;
    }
    assert.ok(
      saved.status === expected ||
        (saved.stage === expected &&
          !["failed", "needs_attention", "cancelled"].includes(saved.status)),
      JSON.stringify(saved) + "\n" + output,
    );
  } finally {
    child.kill("SIGTERM");
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
    await exited;
    clearTimeout(timeout);
  }
  return output
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
}

const mockStorage = `
  import { registerHooks } from "node:module";
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier !== "@volcengine/tos-sdk") return next(specifier, context);
      return {shortCircuit:true, url:"data:text/javascript," + encodeURIComponent(\`
        export const ACLType = {ACLPrivate:"private"};
        export class TosClient {
          async putObject() { return {data:{}}; }
          async deleteObject() { return {data:{}}; }
          getPreSignedUrl({key}) { return "https://fixture.tos-ap-southeast-1.bytepluses.com/" + key; }
          async getObjectV2() { throw Error("Fixture media must be cached locally"); }
        }
      \`)};
    }
  });
`;

test("new workflow workers prepare the original video without SAM or image preparation", async () => {
  for (const workflow of [
    "element_edit",
    "motion_transfer",
    "restyle",
  ] as const) {
    const job = await createFixture(workflow);
    const { stdout } = await promisify(execFile)(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=640x360:r=24:d=4",
        "-c:v",
        "libx264",
        "-f",
        "mp4",
        "-movflags",
        "frag_keyframe+empty_moov",
        "pipe:1",
      ],
      { encoding: "buffer", maxBuffer: 20 * 1024 * 1024 },
    );
    await writeFile(path.join(root, job.source.id), stdout);
    await workspace.update((state) => {
      state.media[job.source.id].bytes = stdout.length;
    });
    const requests = await runWorker(
      job.id,
      "review",
      mockStorage +
        `
      globalThis.fetch = async (url) => { console.log(JSON.stringify({url:String(url)})); throw Error("Network forbidden"); };
    `,
    );
    const saved = await jobRecord(job.id);
    assert.ok(saved.prepared_id);
    assert.ok(saved.frame_id);
    assert.equal(saved.masked_id, null);
    assert.equal(saved.anchor_id, null);
    assert.equal(saved.submission_started_at, null);
    assert.ok(!saved.events.some((event) => event.stage === "masking"));
    assert.deepEqual(requests, []);
  }
});

test("registration submits the prepared original video for new modes instead of a mask", async () => {
  const job = await createFixture("restyle");
  const preparedId = randomUUID(),
    maskedId = randomUUID();
  await workspace.update((state) => {
    for (const [id, kind] of [
      [preparedId, "prepared"],
      [maskedId, "masked"],
    ] as const) {
      state.media[id] = {
        ...state.media[job.source.id],
        id,
        kind,
        storage_key: kind + "/" + id,
      };
    }
  });
  await updateJob(job.id, {
    status: "processing",
    stage: "registering",
    prepared_id: preparedId,
    masked_id: maskedId,
    asset_group_id: "fixture-group",
  });
  const requests = await runWorker(
    job.id,
    "asset_review",
    mockStorage +
      `
    globalThis.fetch = async (url, options) => {
      console.log(JSON.stringify({url:String(url), body:options?.body ? JSON.parse(options.body) : null}));
      return Response.json(String(url).includes("Action=CreateAsset") ? {Result:{Id:"new-asset"}} : {Result:{Status:"Processing"}});
    };
  `,
  );
  const registration = requests.find((request) =>
    request.url.includes("Action=CreateAsset"),
  );
  assert.ok(registration);
  assert.ok(registration.body.URL.endsWith("prepared/" + preparedId));
  assert.ok(!registration.body.URL.includes(maskedId));
  assert.equal((await jobRecord(job.id)).asset_id, "new-asset");
});

test("new-mode preparation recovery reuses saved video and frame IDs without trimming again", async () => {
  for (const workflow of [
    "element_edit",
    "motion_transfer",
    "restyle",
  ] as const) {
    const job = await createFixture(workflow);
    const preparedId = randomUUID(),
      frameId = randomUUID();
    await workspace.update((state) => {
      state.media[preparedId] = {
        ...state.media[job.source.id],
        id: preparedId,
        kind: "prepared",
      };
      state.media[frameId] = {
        ...state.media[job.source.id],
        id: frameId,
        kind: "frame",
        mime: "image/jpeg",
        duration: null,
      };
    });
    await updateJob(job.id, {
      status: "processing",
      prepared_id: preparedId,
      frame_id: frameId,
      lease_owner: "interrupted-worker",
      lease_until: Date.now() - 1,
    });
    const requests = await runWorker(
      job.id,
      "review",
      mockStorage +
        `
      globalThis.fetch = async (url) => {console.log(JSON.stringify({url:String(url)})); throw Error("Network forbidden");};
    `,
    );
    const saved = await jobRecord(job.id);
    assert.equal(saved.prepared_id, preparedId);
    assert.equal(saved.frame_id, frameId);
    assert.equal(saved.masked_id, null);
    assert.deepEqual(requests, []);
  }
});

test("invalid actual video and reference media stop before any paid registration or generation", async () => {
  for (const stage of ["registering", "submitting"] as const) {
    for (const invalid of ["video", "image"] as const) {
      const job = await createFixture("motion_transfer");
      const preparedId = randomUUID();
      await workspace.update((state) => {
        state.media[preparedId] = {
          ...state.media[job.source.id],
          id: preparedId,
          kind: "prepared",
          bytes: invalid === "video" ? 201 * 1024 * 1024 : 1,
        };
        if (invalid === "image")
          state.media[job.references[0].media.id].width = 299;
      });
      await updateJob(job.id, {
        status: "processing",
        stage,
        prepared_id: preparedId,
        asset_id: stage === "submitting" ? "active-asset" : null,
      });
      const requests = await runWorker(
        job.id,
        "failed",
        mockStorage +
          `
        globalThis.fetch = async (url) => {console.log(JSON.stringify({url:String(url)})); throw Error("Network forbidden");};
      `,
      );
      assert.deepEqual(requests, []);
      assert.equal((await jobRecord(job.id)).submission_started_at, null);
    }
  }
});

test("new-mode submissions use ordered references the active video asset and pinned provider model", async () => {
  for (const workflow of [
    "element_edit",
    "motion_transfer",
    "restyle",
  ] as const) {
    const job = await createFixture(workflow);
    const preparedId = randomUUID();
    await workspace.update((state) => {
      state.media[preparedId] = {
        ...state.media[job.source.id],
        id: preparedId,
        kind: "prepared",
      };
      if (workflow === "motion_transfer") {
        const sceneId = randomUUID();
        state.media[sceneId] = {
          ...state.media[job.references[0].media.id],
          id: sceneId,
          storage_key: "scene/" + sceneId,
        };
        state.jobs[job.id].config.references.push({
          id: randomUUID(),
          mediaId: sceneId,
          role: "scene",
        });
      }
    });
    await updateJob(job.id, {
      status: "processing",
      stage: "submitting",
      prepared_id: preparedId,
      asset_id: "active-original",
      seedance_model_id: "pinned-fixture-endpoint",
    });
    const requests = await runWorker(
      job.id,
      "generating",
      mockStorage +
        `
      globalThis.fetch = async (url, options) => {
        console.log(JSON.stringify({method:options?.method, url:String(url), body:options?.body ? JSON.parse(options.body) : null}));
        return Response.json(options?.method === "POST" ? {id:"accepted-transformation"} : {status:"running"});
      };
    `,
    );
    const submissions = requests.filter((request) => request.method === "POST");
    assert.equal(submissions.length, 1);
    const body = submissions[0].body;
    assert.equal(body.model, "pinned-fixture-endpoint");
    assert.equal(
      body.omni_reference_task_type,
      workflow === "motion_transfer" ? "reference" : "edit",
    );
    assert.equal(body.duration, workflow === "motion_transfer" ? 4 : -1);
    assert.equal(body.content[1].video_url.url, "asset://active-original");
    assert.ok(!body.content[0].text.includes("gray masked"));
    const saved = await jobRecord(job.id);
    const urls = await workspace.read((state) =>
      saved.config.references.map(
        (reference) =>
          "https://fixture.tos-ap-southeast-1.bytepluses.com/" +
          state.media[reference.mediaId].storage_key,
      ),
    );
    assert.deepEqual(
      body.content
        .slice(2)
        .map((entry: { image_url: { url: string } }) => entry.image_url.url),
      urls,
    );
    assert.equal(saved.provider_task_id, "accepted-transformation");
    assert.equal(saved.submission_started_at, null);
  }
});

test("new-mode recovery reuses accepted IDs and keeps interrupted submissions ambiguous", async () => {
  for (const workflow of [
    "element_edit",
    "motion_transfer",
    "restyle",
  ] as const) {
    for (const fixture of [
      {
        stage: "registering",
        patch: { asset_id: "saved-asset" },
        expected: "asset_review",
      },
      {
        stage: "submitting",
        patch: { provider_task_id: "saved-task" },
        expected: "generating",
      },
      { stage: "submitting", patch: {}, expected: "needs_attention" },
      {
        stage: "submitting",
        patch: { provider_task_id: "cancel-task", cancel_requested: true },
        expected: "cancelled",
      },
    ]) {
      const job = await createFixture(workflow);
      await updateJob(job.id, {
        status: "processing",
        stage: fixture.stage,
        ...fixture.patch,
        submission_started_at: new Date().toISOString(),
        lease_owner: "interrupted-worker",
        lease_until: Date.now() - 1,
      });
      const requests = await runWorker(
        job.id,
        fixture.expected,
        `
        globalThis.fetch = async (url, options) => {
          console.log(JSON.stringify({method:options?.method ?? "GET", url:String(url)}));
          return Response.json(String(url).includes("Action=GetAsset") ? {Result:{Status:"Processing"}} : {status:"running"});
        };
      `,
      );
      assert.ok(
        !requests.some(
          (request) =>
            request.method === "POST" &&
            !request.url.includes("Action=GetAsset"),
        ),
      );
      const saved = await jobRecord(job.id);
      if (fixture.expected === "generating")
        assert.equal(saved.provider_task_id, "saved-task");
      if (fixture.expected === "asset_review")
        assert.equal(saved.asset_id, "saved-asset");
      if (fixture.expected === "needs_attention")
        assert.ok(saved.submission_started_at);
      if (fixture.expected === "cancelled") {
        assert.equal(saved.provider_task_id, "cancel-task");
        assert.ok(requests.some((request) => request.method === "DELETE"));
      }
    }
  }
});

test("asynchronous task failures expose sanitized codes without provider messages or URLs", async () => {
  const job = await createFixture("restyle");
  await updateJob(job.id, {
    status: "generating",
    stage: "generating",
    provider_task_id: "accepted-task",
  });
  await runWorker(
    job.id,
    "failed",
    `
    globalThis.fetch = async () => Response.json({status:"failed", error:{
      code:"TaskType.NotSupported!<>", message:"private provider message https://private.example/reference?token=sensitive"
    }});
  `,
  );
  const saved = await jobRecord(job.id);
  assert.ok(saved.error?.includes("TaskType.NotSupported"));
  assert.ok(!saved.error?.includes("!<>"));
  assert.ok(!saved.error?.includes("private"));
  assert.ok(!saved.error?.includes("token"));
  assert.equal(saved.provider_task_id, "accepted-task");
});

test("worker recovery reuses saved task, asset and result IDs instead of submitting again", async () => {
  for (const fixture of [
    {
      stage: "submitting",
      patch: { provider_task_id: "fixture-task" },
      expected: "generating",
    },
    {
      stage: "registering",
      patch: { asset_id: "fixture-asset" },
      expected: "asset_review",
    },
    { stage: "generating", patch: { result_id: null }, expected: "complete" },
    { stage: "submitting", patch: {}, expected: "needs_attention" },
    {
      stage: "submitting",
      patch: {
        provider_task_id: "fixture-cancel-task",
        cancel_requested: true,
      },
      expected: "cancelled",
    },
  ]) {
    const sourceId = randomUUID(),
      characterId = randomUUID();
    await workspace.update((state) => {
      state.jobs = {};
      state.media = {};
      for (const [id, kind] of [
        [sourceId, "video"],
        [characterId, "character"],
      ] as const) {
        state.media[id] = {
          id,
          kind,
          name: "fixture",
          mime: kind === "video" ? "video/mp4" : "image/jpeg",
          bytes: 1,
          width: 600,
          height: 600,
          duration: kind === "video" ? 4 : null,
          storage_key: "fixture/" + id,
          poster_id: null,
        };
      }
    });
    const job = await createJob(
      createJobSchema.parse({
        sourceId,
        characterId,
        prompt: "Synthetic recovery validation",
        duration: 4,
      }),
    );
    const patch =
      fixture.stage === "generating" ? { result_id: sourceId } : fixture.patch;
    await updateJob(job.id, {
      status: "processing",
      stage: fixture.stage,
      ...patch,
      submission_started_at: new Date().toISOString(),
      lease_owner: "interrupted-worker",
      lease_until: Date.now() - 1,
    });
    const preload = `
      globalThis.fetch = async (url, options) => {
        console.log(JSON.stringify({method: options?.method ?? "GET", url: String(url)}));
        return Response.json(String(url).includes("Action=GetAsset") ? {Result:{Status:"Processing"}} : {status:"running"});
      };
    `;
    const child = spawn(
      process.execPath,
      [
        "--import",
        path.join(project, "node_modules/tsx/dist/loader.mjs"),
        "--import",
        "data:text/javascript," + encodeURIComponent(preload),
        path.join(project, "scripts/worker.ts"),
      ],
      {
        cwd: root,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "production",
          MEDIA_ROOT: root,
          STORAGE_MODE: "tos",
          TOS_BUCKET: "fixture-bucket",
          BYTEPLUS_ACCESS_KEY: "fixture-access",
          BYTEPLUS_SECRET_KEY: "fixture-secret",
          BYTEPLUS_API_KEY: "fixture-model-key",
          BYTEPLUS_SESSION_TOKEN: "",
          META_API_KEY: "",
          WORKER_POLL_MS: "500",
          TSX_TSCONFIG_PATH: path.join(project, "tsconfig.json"),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.resume();
    const exited = new Promise((resolve) => child.once("exit", resolve));
    try {
      const deadline = Date.now() + 10000;
      let saved = await jobRecord(job.id);
      while (
        saved.stage !== fixture.expected &&
        saved.status !== fixture.expected &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        saved = await jobRecord(job.id);
      }
      assert.ok(
        saved.stage === fixture.expected || saved.status === fixture.expected,
        JSON.stringify(saved),
      );
      if (fixture.expected === "needs_attention")
        assert.equal(saved.provider_task_id, null);
      if (fixture.expected === "generating")
        assert.equal(saved.provider_task_id, "fixture-task");
      if (fixture.expected === "asset_review")
        assert.equal(saved.asset_id, "fixture-asset");
      if (fixture.expected === "complete")
        assert.equal(saved.result_id, sourceId);
    } finally {
      child.kill("SIGTERM");
      const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
      await exited;
      clearTimeout(timeout);
    }
    const requests = output
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line));
    assert.equal(
      requests.some(
        (request) =>
          request.method === "POST" && !request.url.includes("Action=GetAsset"),
      ),
      false,
      output,
    );
    if (fixture.expected === "cancelled") {
      assert.equal(
        (await jobRecord(job.id)).provider_task_id,
        "fixture-cancel-task",
      );
      assert.ok(requests.some((request) => request.method === "DELETE"));
    }
  }
});
