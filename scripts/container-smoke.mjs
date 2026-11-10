import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const project = fileURLToPath(new URL("..", import.meta.url));
const instance = randomUUID();
const projects = ["seed-smoke-" + instance, "seed-restore-" + instance];
const env = { ...process.env, STUDIO_SMOKE_INSTANCE: instance };
const directory = await mkdtemp(path.join(tmpdir(), "seed-container-smoke-"));
const snapshotCode = `
  import fs from "node:fs/promises";
  import path from "node:path";
  import {createHash} from "node:crypto";
  const root="/app/.data";
  const result={};
  async function walk(dir) {
    for(const entry of await fs.readdir(dir,{withFileTypes:true})) {
      const file=path.join(dir,entry.name);
      if(entry.isDirectory()) await walk(file);
      else result[path.relative(root,file)]=createHash("sha256").update(await fs.readFile(file)).digest("hex");
    }
  }
  await walk(root);
  console.log(JSON.stringify(result));
`;
async function compose(name, args, options = {}) {
  const pending = run(
    "docker",
    [
      "compose",
      "-p",
      name,
      "-f",
      path.join(project, "compose.smoke.yaml"),
      ...args,
    ],
    {
      cwd: project,
      env,
      timeout: 600000,
      maxBuffer: 128 * 1024 * 1024,
      ...options,
    },
  );
  if (options.input) pending.child.stdin.end(options.input);
  return pending;
}
async function snapshot(name) {
  return JSON.parse(
    (
      await compose(name, [
        "run",
        "--rm",
        "-T",
        "--no-deps",
        "--entrypoint",
        "node",
        "web",
        "--input-type=module",
        "-e",
        snapshotCode,
      ])
    ).stdout,
  );
}
try {
  await compose(projects[0], [
    "up",
    "--build",
    "-d",
    "--wait",
    "--wait-timeout",
    "90",
  ]);
  for (const script of ["smoke.ts", "demo-smoke.ts"]) {
    const result = await compose(projects[0], [
      "exec",
      "-T",
      "web",
      "node",
      "--import",
      "tsx",
      "scripts/" + script,
    ]);
    process.stdout.write(result.stdout);
  }
  await compose(projects[0], ["stop", "worker"]);
  await compose(projects[0], [
    "exec",
    "-T",
    "web",
    "node",
    "--input-type=module",
    "-e",
    `
    import assert from "node:assert/strict";
    const end=Date.now()+40000;
    while((await fetch("http://127.0.0.1:3107/api/health?worker=1")).ok && Date.now()<end)
      await new Promise(resolve=>setTimeout(resolve,500));
    assert.equal((await fetch("http://127.0.0.1:3107/api/health?worker=1")).status,503);
    assert.equal((await fetch("http://127.0.0.1:3107/api/health")).status,200);
  `,
  ]);
  await compose(projects[0], ["stop", "web"]);
  const before = await snapshot(projects[0]);
  assert.ok(before["workspace.json"]);
  assert.ok(Object.keys(before).length > 3);
  const backup = (
    await compose(
      projects[0],
      [
        "run",
        "--rm",
        "-T",
        "--no-deps",
        "--entrypoint",
        "tar",
        "web",
        "-C",
        "/app/.data",
        "-cf",
        "-",
        ".",
      ],
      { encoding: "buffer" },
    )
  ).stdout;
  await writeFile(path.join(directory, "backup.tar"), backup, { mode: 0o600 });
  await compose(
    projects[1],
    [
      "run",
      "--rm",
      "-T",
      "--no-deps",
      "--entrypoint",
      "tar",
      "web",
      "-C",
      "/app/.data",
      "-xf",
      "-",
    ],
    { input: backup },
  );
  assert.deepEqual(await snapshot(projects[1]), before);
  await compose(projects[1], [
    "up",
    "-d",
    "--no-build",
    "--wait",
    "--wait-timeout",
    "90",
  ]);
  await compose(projects[1], [
    "exec",
    "-T",
    "web",
    "node",
    "--input-type=module",
    "-e",
    `
    import assert from "node:assert/strict";
    const base="http://127.0.0.1:3107";
    assert.equal((await fetch(base+"/api/health?worker=1")).status,200);
    const {jobs}=await (await fetch(base+"/api/jobs")).json();
    assert.ok(jobs.length>0);
    const response=await fetch(base+jobs[0].source.url);
    assert.equal(response.status,200);
    assert.ok((await response.arrayBuffer()).byteLength>0);
  `,
  ]);
  console.log(
    "PASS: container runtime, worker readiness, stopped-volume backup, byte-identical restore, and persisted media after restart.",
  );
} finally {
  let cleanupError;
  for (const name of projects) {
    try {
      await compose(name, ["down", "-v", "--remove-orphans"]);
    } catch (error) {
      cleanupError = error;
    }
  }
  await rm(directory, { recursive: true, force: true });
  if (cleanupError) throw cleanupError;
}
