import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, stat, rm } from "node:fs/promises";
import path from "node:path";
import { TosClient, ACLType } from "@volcengine/tos-sdk";
import { env } from "@/env";
import { sql } from "./db";
import { AppError } from "./http";
import type { Upload } from "@/lib/schemas";

export const mediaRoot = path.resolve(env.MEDIA_ROOT);
let client: TosClient | undefined;
export function tos() {
  if (!env.TOS_BUCKET || !env.TOS_ACCESS_KEY || !env.TOS_SECRET_KEY)
    throw new AppError(
      503,
      "STORAGE_SETUP",
      "Connect your private BytePlus TOS bucket and access keys.",
    );
  return (client ??= new TosClient({
    accessKeyId: env.TOS_ACCESS_KEY,
    accessKeySecret: env.TOS_SECRET_KEY,
    stsToken: env.TOS_SESSION_TOKEN,
    region: env.TOS_REGION,
    endpoint: env.TOS_ENDPOINT,
    secure: true,
    requestTimeout: 120000,
  }));
}
export async function storageCheck() {
  await tos().headBucket(env.TOS_BUCKET!);
}
export type MediaRow = {
  id: string;
  user_id: string;
  kind: Upload["kind"];
  name: string;
  mime: string;
  bytes: string;
  width: number;
  height: number;
  duration: number | null;
  storage_key: string;
  poster_id: string | null;
};
export function publicUpload(row: MediaRow): Upload {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    mime: row.mime,
    bytes: Number(row.bytes),
    width: row.width,
    height: row.height,
    duration: row.duration,
    url: "/api/media/" + row.id,
    posterUrl: row.poster_id ? "/api/media/" + row.poster_id : null,
  };
}
export async function ownedMedia(id: string, userId: string) {
  const rows = await sql<MediaRow>(
    "SELECT * FROM uploads WHERE id=$1 AND user_id=$2",
    [id, userId],
  );
  if (!rows[0]) throw new AppError(404, "NOT_FOUND", "Media not found.");
  return rows[0];
}
export async function localPath(row: MediaRow) {
  const file = path.join(mediaRoot, row.id);
  try {
    await stat(file);
  } catch {
    if (env.STORAGE_MODE !== "tos")
      throw new AppError(404, "FILE_MISSING", "Media file is unavailable.");
    const result = await tos().getObjectV2({
      bucket: env.TOS_BUCKET!,
      key: row.storage_key,
      dataType: "buffer",
    });
    await mkdir(mediaRoot, { recursive: true });
    await writeFile(file, result.data.content, { mode: 0o600 });
  }
  return file;
}
export async function providerUrl(row: MediaRow, download = false) {
  if (env.STORAGE_MODE !== "tos")
    throw new AppError(
      503,
      "PUBLIC_STORAGE_REQUIRED",
      "Connect BytePlus TOS for signed provider references.",
    );
  // Public endpoint: fal.ai and the browser cannot reach a TOS internal endpoint.
  return tos().getPreSignedUrl({
    bucket: env.TOS_BUCKET!,
    key: row.storage_key,
    method: "GET",
    expires: 21600,
    query: { "response-cache-control": "private, no-store" },
    response: download
      ? {
          contentDisposition:
            'attachment; filename="' +
            row.name.replace(/[^a-zA-Z0-9._-]/g, "_") +
            '"',
        }
      : undefined,
  });
}
export async function deleteStoredMedia(
  rows: Pick<MediaRow, "id" | "storage_key">[],
) {
  if (rows.length && env.STORAGE_MODE === "tos") {
    const result = await tos().deleteMultiObjects({
      bucket: env.TOS_BUCKET!,
      objects: rows.map((row) => ({ key: row.storage_key })),
    });
    if (result.data.Error?.length)
      throw new Error("Some TOS objects could not be removed.");
  }
  await Promise.all(
    rows.map((row) => rm(path.join(mediaRoot, row.id), { force: true })),
  );
}
export async function saveMedia(input: {
  userId: string;
  kind: Upload["kind"];
  name: string;
  mime: string;
  data: Buffer;
  width: number;
  height: number;
  duration?: number | null;
  posterId?: string;
}) {
  const id = randomUUID();
  const key = "recast-studio/" + input.userId + "/" + id;
  await mkdir(mediaRoot, { recursive: true });
  await writeFile(path.join(mediaRoot, id), input.data, { mode: 0o600 });
  let uploaded = false;
  try {
    if (env.STORAGE_MODE === "tos") {
      await tos().putObject({
        bucket: env.TOS_BUCKET!,
        key,
        body: input.data,
        contentType: input.mime,
        cacheControl: "private, no-store",
        acl: ACLType.ACLPrivate,
        serverSideEncryption: "AES256",
      });
      uploaded = true;
    }
    const rows = await sql<MediaRow>(
      "INSERT INTO uploads (id,user_id,kind,name,mime,bytes,width,height,duration,storage_key,poster_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
      [
        id,
        input.userId,
        input.kind,
        input.name,
        input.mime,
        input.data.length,
        input.width,
        input.height,
        input.duration ?? null,
        key,
        input.posterId ?? null,
      ],
    );
    return rows[0];
  } catch (error) {
    await rm(path.join(mediaRoot, id), { force: true });
    if (uploaded)
      await tos()
        .deleteObject({ bucket: env.TOS_BUCKET!, key })
        .catch(() => {});
    throw error;
  }
}
export const mediaBytes = async (row: MediaRow) =>
  readFile(await localPath(row));
