import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
nextEnv.loadEnvConfig(process.cwd());
const { env } = await import("../src/env");
const { sql, pool } = await import("../src/server/db");
const { probe } = await import("../src/server/media");
const { localPath, deleteStoredMedia } = await import("../src/server/storage");
import type { MediaRow } from "../src/server/storage";

const { jobSchema, uploadSchema, userSchema } =
  await import("../src/lib/schemas");
const base = process.argv[2] ?? env.APP_URL;
const run = promisify(execFile);
const dir = await mkdtemp(path.join(tmpdir(), "recast-smoke-"));
const users: string[] = [];
const checks: string[] = [];
if (env.FAL_KEY)
  throw new Error(
    "Run smoke checks on a disposable instance with FAL_KEY unset. They intentionally exercise the missing-credential path and never submit paid jobs.",
  );
if (env.REGISTRATION_ENABLED !== "true")
  throw new Error(
    "Enable registration on the disposable test instance before smoke testing.",
  );
const client = () => {
  let cookie = "";
  return {
    async request(endpoint: string, status: number, options: RequestInit = {}) {
      const headers = new Headers(options.headers);
      if (cookie) headers.set("Cookie", cookie);
      headers.set("Origin", new URL(env.APP_URL).origin);
      const response = await fetch(base + "/api" + endpoint, {
        ...options,
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(120000),
      });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      assert.equal(
        response.status,
        status,
        endpoint + " returned " + response.status + " instead of " + status,
      );
      checks.push((options.method ?? "GET") + " " + endpoint + " → " + status);
      return response;
    },
    async json(endpoint: string, status: number, data?: unknown) {
      return (
        await this.request(
          endpoint,
          status,
          data === undefined
            ? {}
            : {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
              },
        )
      ).json();
    },
  };
};
async function untilJob(
  c: ReturnType<typeof client>,
  id: string,
  status: string,
) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const job = jobSchema.parse((await c.json("/jobs/" + id, 200)).job);
    if (job.status === status) return job;
    if (
      ["succeeded", "failed", "needs_attention", "cancelled"].includes(
        job.status,
      )
    )
      throw new Error(
        "Expected " + status + ", received " + job.status + ": " + job.error,
      );
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Worker did not reach " + status + " within 90 seconds.");
}
try {
  await run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=44100",
    "-t",
    "6",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    path.join(dir, "source.mp4"),
  ]);
  const sharp = (await import("sharp")).default;
  await sharp({
    create: { width: 512, height: 768, channels: 3, background: "#c8bca8" },
  })
    .jpeg()
    .toFile(path.join(dir, "character.jpg"));
  const a = client(),
    b = client(),
    guest = client();
  await guest.json("/jobs", 401);
  await guest.json("/capabilities", 401);
  const foreign = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: {
      Origin: "https://untrusted.example",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(foreign.status, 403);
  checks.push("Foreign origin POST → 403");
  const password = randomUUID() + "!aA";
  const email = "smoke-" + randomUUID() + "@recast.test";
  const userA = userSchema.parse(
    (
      await a.json("/auth/register", 201, {
        email,
        password,
        name: "Smoke A",
        inviteCode: env.INVITE_CODE,
      })
    ).user,
  );
  users.push(userA.id);
  const userB = userSchema.parse(
    (
      await b.json("/auth/register", 201, {
        email: "smoke-" + randomUUID() + "@recast.test",
        password,
        name: "Smoke B",
        inviteCode: env.INVITE_CODE,
      })
    ).user,
  );
  users.push(userB.id);
  await guest.json("/auth/register", 409, {
    email,
    password,
    name: "Duplicate",
    inviteCode: env.INVITE_CODE,
  });
  await guest.json("/auth/login", 401, { email, password: randomUUID() });
  await a.json("/auth/logout", 200, {});
  await a.json("/jobs", 401);
  await a.json("/auth/login", 200, { email, password });
  assert.equal((await a.json("/auth/session", 200)).user.id, userA.id);
  async function upload(kind: string, file: string, mime: string) {
    const form = new FormData();
    form.set("kind", kind);
    form.set(
      "file",
      new File([await readFile(file)], path.basename(file), { type: mime }),
    );
    return uploadSchema.parse(
      (
        await (
          await a.request("/uploads", 201, { method: "POST", body: form })
        ).json()
      ).upload,
    );
  }
  const video = await upload(
    "video",
    path.join(dir, "source.mp4"),
    "video/mp4",
  );
  const character = await upload(
    "character",
    path.join(dir, "character.jpg"),
    "image/jpeg",
  );
  const invalid = new FormData();
  invalid.set("kind", "video");
  invalid.set(
    "file",
    new File(["not a video"], "invalid.mp4", { type: "video/mp4" }),
  );
  await a.request("/uploads", 400, { method: "POST", body: invalid });
  await b.json("/media/" + video.id, 404);
  const media = await a.request(
    "/media/" + video.id,
    env.STORAGE_MODE === "tos" ? 307 : 206,
    { headers: { Range: "bytes=0-99" } },
  );
  if (env.STORAGE_MODE === "tos") {
    const download = await fetch(media.headers.get("location")!, {
      headers: { Range: "bytes=0-99" },
    });
    assert.equal(download.status, 206);
    assert.equal((await download.arrayBuffer()).byteLength, 100);
    checks.push("Private TOS signed download → 206, 100 bytes");
  } else assert.equal((await media.arrayBuffer()).byteLength, 100);
  const input = {
    sourceId: video.id,
    characterId: character.id,
    prompt: "Replace the performer and preserve the scene.",
    target: "person",
    duration: 4,
    start: 1,
    resolution: "480p",
    prepareImage: false,
    preserveAudio: true,
  };
  await a.json("/jobs", 400, { ...input, start: 4 });
  await a.json("/jobs", 400, { ...input, duration: 31 });
  await b.json("/jobs", 404, input);
  const job = jobSchema.parse((await a.json("/jobs", 202, input)).job);
  await b.json("/jobs/" + job.id, 404);
  await b.json("/jobs/" + job.id + "/approve", 404, {});
  await b.json("/jobs/" + job.id + "/cancel", 404, {});
  await a.json("/jobs/" + job.id + "/approve", 409, {});
  const failed = await untilJob(a, job.id, "failed");
  assert.match(failed.error ?? "", /fal\.ai/);
  assert.ok(failed.frame);
  const rows = await sql<MediaRow>(
    "SELECT j.prepared_id,u.* FROM jobs j JOIN uploads u ON j.prepared_id=u.id WHERE j.id=$1",
    [job.id],
  );
  assert.equal(rows.length, 1);
  const prepared = await probe(await localPath(rows[0]));
  assert.ok(Math.abs(prepared.duration - 4) < 0.15);
  assert.ok(prepared.width * prepared.height >= 407696);
  assert.ok(prepared.hasAudio);
  checks.push(
    "Real worker FFmpeg trim + first frame + source audio persisted; missing fal.ai → explicit failure",
  );
  assert.ok(
    (await a.json("/jobs", 200)).jobs.some(
      (j: { id: string }) => j.id === job.id,
    ),
  );
  const ambiguous = jobSchema.parse((await a.json("/jobs", 202, input)).job);
  await sql(
    "UPDATE jobs SET submission_started_at=now(),stage='submitting',status='processing' WHERE id=$1",
    [ambiguous.id],
  );
  const attention = await untilJob(a, ambiguous.id, "needs_attention");
  assert.match(attention.error ?? "", /submission was interrupted/);
  const state = await sql("SELECT provider_task_id FROM jobs WHERE id=$1", [
    ambiguous.id,
  ]);
  assert.equal(state[0].provider_task_id, null);
  checks.push(
    "Unconfirmed submission recovery stops for manual review, without a provider task",
  );
  const cancellable = jobSchema.parse((await a.json("/jobs", 202, input)).job);
  await a.json("/jobs/" + cancellable.id + "/cancel", 200, {});
  await untilJob(a, cancellable.id, "cancelled");
  await a.json("/auth/logout", 200, {});
  await a.json("/jobs/" + job.id, 401);
  const report = {
    testedAt: new Date().toISOString(),
    base,
    storage: env.STORAGE_MODE,
    checks,
    paidGeneration: "Not executed: fal.ai credentials are pending.",
  };
  await mkdir("output", { recursive: true });
  await writeFile("output/smoke-results.json", JSON.stringify(report, null, 2));
  console.log(
    "PASS: " +
      checks.length +
      " real API and persistence checks. Storage: " +
      env.STORAGE_MODE +
      ". Paid generation was not executed.",
  );
} finally {
  const media = users.length
    ? await sql<Pick<MediaRow, "id" | "storage_key">>(
        "SELECT id,storage_key FROM uploads WHERE user_id=ANY($1::uuid[])",
        [users],
      )
    : [];
  await deleteStoredMedia(media);
  if (users.length) {
    await sql("DELETE FROM jobs WHERE user_id=ANY($1::uuid[])", [users]);
    await sql("DELETE FROM uploads WHERE user_id=ANY($1::uuid[])", [users]);
    await sql("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  }
  await rm(dir, { recursive: true, force: true });
  await pool.end();
}
