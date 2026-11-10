import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, stat, rm, rename } from "node:fs/promises";
import path from "node:path";
import { TosClient, ACLType } from "@volcengine/tos-sdk";
import { env } from "@/env";
import { workspace, type StoredMedia } from "./workspace";
export type { StoredMedia } from "./workspace";
import { AppError } from "./http";
import type { Upload } from "@/lib/schemas";

export const mediaRoot = path.resolve(env.MEDIA_ROOT);
let client: TosClient | undefined;
export function tos() {
  if (!env.TOS_BUCKET || !env.BYTEPLUS_ACCESS_KEY || !env.BYTEPLUS_SECRET_KEY)
    throw new AppError(
      503,
      "STORAGE_SETUP",
      "Connect your private TOS bucket and shared BytePlus access keys.",
    );
  return (client ??= new TosClient({
    accessKeyId: env.BYTEPLUS_ACCESS_KEY,
    accessKeySecret: env.BYTEPLUS_SECRET_KEY,
    stsToken: env.BYTEPLUS_SESSION_TOKEN,
    region: env.TOS_REGION,
    endpoint: env.TOS_ENDPOINT,
    secure: true,
    requestTimeout: 120000,
  }));
}
export async function storageCheck() {
  await tos().headBucket(env.TOS_BUCKET!);
}
export function publicUpload(row: StoredMedia): Upload {
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
export async function getMedia(id: string) {
  return workspace.read((state) => {
    const media = state.media[id];
    if (!media) throw new AppError(404, "NOT_FOUND", "Media not found.");
    return media;
  });
}
export async function localPath(row: StoredMedia) {
  const file = path.join(mediaRoot, row.id);
  const cached = await stat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (cached?.isFile() && cached.size === row.bytes) return file;
  if (env.STORAGE_MODE !== "tos")
    throw new AppError(404, "FILE_MISSING", "Media file is unavailable.");
  const result = await tos().getObjectV2({
    bucket: env.TOS_BUCKET!,
    key: row.storage_key,
    dataType: "buffer",
  });
  const content = result.data.content;
  if (!Buffer.isBuffer(content) || content.length !== row.bytes)
    throw new AppError(
      502,
      "FILE_RECOVERY",
      "Media could not be recovered from storage. Try again when storage is available.",
    );
  await mkdir(mediaRoot, { recursive: true });
  const temporary = file + "." + randomUUID() + ".tmp";
  try {
    // An immutable object can be recovered concurrently. Publish only complete
    // private copies, so another reader never opens an in-progress cache write.
    await writeFile(temporary, content, { mode: 0o600, flag: "wx" });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
  return file;
}
export async function providerUrl(row: StoredMedia, download = false) {
  if (env.STORAGE_MODE !== "tos")
    throw new AppError(
      503,
      "PUBLIC_STORAGE_REQUIRED",
      "Connect BytePlus TOS for signed provider references.",
    );
  // Meta, BytePlus and the browser need the bucket's public TOS endpoint.
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
  rows: Pick<StoredMedia, "id" | "storage_key">[],
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
  const key = "recast-studio/local/" + id;
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
    const media: StoredMedia = {
      id,
      kind: input.kind,
      name: input.name,
      mime: input.mime,
      bytes: input.data.length,
      width: input.width,
      height: input.height,
      duration: input.duration ?? null,
      storage_key: key,
      poster_id: input.posterId ?? null,
    };
    await workspace.update((state) => {
      state.media[id] = media;
    });
    return media;
  } catch (error) {
    await rm(path.join(mediaRoot, id), { force: true });
    if (uploaded)
      await tos()
        .deleteObject({ bucket: env.TOS_BUCKET!, key })
        .catch(() => {});
    throw error;
  }
}
export const mediaBytes = async (row: StoredMedia) =>
  readFile(await localPath(row));
