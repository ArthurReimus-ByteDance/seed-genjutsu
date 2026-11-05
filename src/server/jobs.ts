import { sql } from "./db";
import { ownedMedia, publicUpload, type MediaRow } from "./storage";
import { AppError } from "./http";
import { env } from "@/env";
import { createJobSchema, type CreateJob, type Job } from "@/lib/schemas";
export type JobRow = {
  id: string;
  user_id: string;
  name: string;
  prompt: string;
  config: CreateJob;
  source_id: string;
  character_id: string;
  prepared_id: string | null;
  frame_id: string | null;
  anchor_id: string | null;
  masked_id: string | null;
  result_id: string | null;
  status: Job["status"];
  stage: string;
  progress: number;
  error: string | null;
  created_at: Date;
  updated_at: Date;
  sam_request_id: string | null;
  provider_task_id: string | null;
  asset_id: string | null;
  asset_group_id: string | null;
  submission_started_at: Date | null;
  cancel_requested: boolean;
};
export async function jobRow(id: string, userId?: string) {
  const rows = await sql<JobRow>(
    "SELECT * FROM jobs WHERE id=$1" + (userId ? " AND user_id=$2" : ""),
    userId ? [id, userId] : [id],
  );
  if (!rows[0]) throw new AppError(404, "NOT_FOUND", "Generation not found.");
  return rows[0];
}
export async function presentJob(row: JobRow): Promise<Job> {
  const ids = [
    row.source_id,
    row.character_id,
    row.frame_id,
    row.anchor_id,
    row.masked_id,
    row.result_id,
  ].filter(Boolean);
  const media = await sql<MediaRow>(
    "SELECT * FROM uploads WHERE id=ANY($1::uuid[]) AND user_id=$2",
    [ids, row.user_id],
  );
  const find = (id: string | null) => media.find((m) => m.id === id);
  const get = (id: string | null) => {
    const m = find(id);
    return m ? publicUpload(m) : null;
  };
  const events = await sql(
    "SELECT id,stage,message,created_at FROM job_events WHERE job_id=$1 ORDER BY id ASC",
    [row.id],
  );
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    status: row.status,
    stage: row.stage,
    progress: row.progress,
    config: createJobSchema.parse(row.config),
    source: get(row.source_id)!,
    character: get(row.character_id)!,
    frame: get(row.frame_id),
    anchor: get(row.anchor_id),
    masked: get(row.masked_id),
    result: get(row.result_id),
    error: row.error,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    events: events.map((e) => ({
      id: Number(e.id),
      stage: e.stage,
      message: e.message,
      createdAt: e.created_at.toISOString(),
    })),
  };
}
export async function createJob(userId: string, input: CreateJob) {
  const source = await ownedMedia(input.sourceId, userId);
  const character = await ownedMedia(input.characterId, userId);
  if (source.kind !== "video" || character.kind !== "character")
    throw new AppError(
      400,
      "INVALID_INPUT",
      "Choose a source video and a character image.",
    );
  if (!source.duration || input.start + input.duration > source.duration + 0.06)
    throw new AppError(
      400,
      "INVALID_TRIM",
      "The selected range extends past the video.",
    );
  if (input.prepareImage && !env.SEEDREAM_MODEL)
    throw new AppError(
      503,
      "IMAGE_SETUP",
      "The Seedream image model is not connected yet. Disable first-frame preparation or configure its verified model ID.",
    );
  const client = await (await import("./db")).pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    const active = await client.query(
      "SELECT count(*)::int AS count FROM jobs WHERE user_id=$1 AND status IN ('queued','processing','generating','awaiting_approval')",
      [userId],
    );
    const daily = await client.query(
      "SELECT count(*)::int AS count FROM jobs WHERE user_id=$1 AND created_at>now()-interval '1 day'",
      [userId],
    );
    if (
      active.rows[0].count >= env.MAX_ACTIVE_JOBS ||
      daily.rows[0].count >= env.MAX_DAILY_JOBS
    )
      throw new AppError(
        429,
        "GENERATION_LIMIT",
        "Your workspace generation limit has been reached.",
      );
    const result = await client.query<JobRow>(
      "INSERT INTO jobs (user_id,name,prompt,config,source_id,character_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [
        userId,
        input.prompt.slice(0, 60),
        input.prompt,
        JSON.stringify(input),
        source.id,
        character.id,
      ],
    );
    await client.query(
      "INSERT INTO job_events (job_id,stage,message) VALUES ($1,'queued','Your generation is in the processing queue.')",
      [result.rows[0].id],
    );
    await client.query("COMMIT");
    return presentJob(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function event(id: string, stage: string, message: string) {
  await sql("INSERT INTO job_events (job_id,stage,message) VALUES ($1,$2,$3)", [
    id,
    stage,
    message,
  ]);
}
export async function transition(
  id: string,
  status: string,
  stage: string,
  progress: number,
  message: string,
) {
  const rows = await sql(
    "UPDATE jobs SET status=$2,stage=$3,progress=$4,updated_at=now(),next_run_at=now(),lease_until=NULL,lease_owner=NULL WHERE id=$1 AND cancel_requested=false RETURNING id",
    [id, status, stage, progress],
  );
  if (rows.length) await event(id, stage, message);
}
