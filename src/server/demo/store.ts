import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { env } from "@/env";
import { AppError } from "@/server/http";
import {
  jobSchema,
  uploadSchema,
  type CreateJob,
  type Upload,
} from "@/lib/schemas";
import { registrationMediaId } from "@/lib/workflows";
import {
  validateSourceVideo,
  validateReferenceImage,
  validateReferenceVideo,
} from "../reference-media";
import { JsonFileStore } from "../json-file";
import { advanceDemo, type DemoRecord } from "./lifecycle";
export type DemoMedia = Upload & { file: string };
export type DemoStore = {
  id: string;
  uploads: DemoMedia[];
  jobs: DemoRecord[];
};
export const demoRoot = path.join(path.resolve(env.MEDIA_ROOT), "demo");
export function requireDemoEnabled() {
  if (env.DEMO_ENABLED !== "true")
    throw new AppError(404, "NOT_FOUND", "Page not found.");
}
const demoSchema = z.object({
  id: z.literal("local"),
  uploads: z.array(uploadSchema.extend({ file: z.string() })),
  jobs: z.array(
    z.object({
      job: jobSchema,
      scenario: z.enum(["success", "failure"]),
      approvedAt: z.string().nullable(),
      prepared: uploadSchema.nullable().default(null),
      masked: uploadSchema.nullable().default(null),
      anchor: uploadSchema.nullable().default(null),
      result: uploadSchema,
    }),
  ),
});
const previewStore = new JsonFileStore<DemoStore>(
  path.join(demoRoot, "local", "workspace.json"),
  demoSchema,
  () => ({ id: "local", uploads: [], jobs: [] }),
);
export function withDemo<T>(
  action: (store: DemoStore) => Promise<T>,
): Promise<T> {
  requireDemoEnabled();
  return previewStore.update(async (store) => {
    store.jobs = store.jobs.map((record) => advanceDemo(record));
    return action(store);
  });
}
export function media(store: DemoStore, id: string) {
  const found = store.uploads.find((item) => item.id === id);
  if (!found)
    throw new AppError(
      404,
      "NOT_FOUND",
      "Reference not found in this preview workspace.",
    );
  return found;
}
export function resolveDemoInputs(store: DemoStore, config: CreateJob) {
  const source = media(store, config.sourceId);
  validateSourceVideo(source, config.start, config.duration);
  const character = config.characterId
    ? media(store, config.characterId)
    : null;
  if (character) validateReferenceImage(character, "character");
  const references = config.references.map((reference) => {
    const image = media(store, reference.mediaId);
    validateReferenceImage(image, "character");
    return {
      id: reference.id,
      role: reference.role,
      media: publicDemoMedia(image),
    };
  });
  return { source, character, references };
}
export function presentDemoJob(store: DemoStore, record: DemoRecord) {
  const { job } = record;
  if (
    job.source.id !== job.config.sourceId ||
    (job.character?.id ?? null) !== (job.config.characterId ?? null)
  )
    throw new AppError(
      400,
      "INVALID_INPUT",
      "The saved media references do not match this take.",
    );
  const { source, character, references } = resolveDemoInputs(
    store,
    job.config,
  );
  const optionalMedia = (item: Upload | null) => {
    const found = item && store.uploads.find((upload) => upload.id === item.id);
    return found ? publicDemoMedia(found) : null;
  };
  return jobSchema.parse({
    ...job,
    source: publicDemoMedia(source),
    character: character ? publicDemoMedia(character) : null,
    references,
    prepared: optionalMedia(job.prepared),
    frame: optionalMedia(job.frame),
    anchor: optionalMedia(job.anchor),
    masked: optionalMedia(job.masked),
    result: optionalMedia(job.result),
  });
}
export function reviewDemoMedia(store: DemoStore, record: DemoRecord) {
  resolveDemoInputs(store, record.job.config);
  const { job } = record;
  const id = registrationMediaId({
    config: job.config,
    prepared_id: job.prepared?.id ?? null,
    masked_id: job.masked?.id ?? null,
  });
  if (!id)
    throw new AppError(
      409,
      "NOT_AWAITING_APPROVAL",
      "This take has missing or invalid prepared references.",
    );
  const registration = media(store, id);
  const expectedKind =
    job.config.workflow === "character_swap" ? "masked" : "prepared";
  validateReferenceVideo(registration, expectedKind, job.config.duration);
  const anchor = job.anchor ? media(store, job.anchor.id) : null;
  if (job.config.prepareImage && !anchor)
    throw new AppError(
      400,
      "MISSING_ANCHOR",
      "The prepared scene image is missing.",
    );
  if (anchor) validateReferenceImage(anchor, "anchor");
  const imageCount =
    job.config.references.length +
    (job.config.characterId ? 1 : 0) +
    (anchor && job.config.workflow === "character_swap" ? 1 : 0);
  if (imageCount > (job.config.model === "seedance-2.5" ? 30 : 9))
    throw new AppError(
      400,
      "REFERENCE_LIMIT",
      "Too many images for this model.",
    );
}
export function demoJob(store: DemoStore, id: string) {
  const record = store.jobs.find((item) => item.job.id === id);
  if (!record)
    throw new AppError(
      404,
      "NOT_FOUND",
      "Take not found in this preview workspace.",
    );
  return record;
}
export async function saveDemoMedia(
  store: DemoStore,
  input: Omit<DemoMedia, "id" | "url" | "posterUrl" | "file"> & {
    data?: Buffer;
    file?: string;
    posterUrl?: string | null;
  },
) {
  const id = randomUUID();
  const file = input.file ?? path.join(demoRoot, store.id, id);
  if (input.data) await writeFile(file, input.data, { mode: 0o600 });
  const item: DemoMedia = {
    id,
    kind: input.kind,
    name: input.name,
    mime: input.mime,
    bytes: input.bytes,
    width: input.width,
    height: input.height,
    duration: input.duration,
    file,
    url: "/api/demo/media/" + id,
    posterUrl: input.posterUrl ?? null,
  };
  store.uploads.push(item);
  return item;
}
export const publicDemoMedia = ({ file: _, ...item }: DemoMedia): Upload => {
  void _;
  return item;
};
export async function sampleReferences(store: DemoStore) {
  const source = await saveDemoMedia(store, {
    kind: "video",
    name: "Gallery performance.mp4",
    mime: "video/mp4",
    bytes: 580000,
    width: 1280,
    height: 720,
    duration: 6,
    file: path.join(process.cwd(), "public/samples/source.mp4"),
    posterUrl: "/samples/source.jpg",
  });
  const character = await saveDemoMedia(store, {
    kind: "character",
    name: "Pearl android.jpg",
    mime: "image/jpeg",
    bytes: 180000,
    width: 1280,
    height: 720,
    duration: null,
    file: path.join(process.cwd(), "public/samples/character.jpg"),
  });
  return {
    source: publicDemoMedia(source),
    character: publicDemoMedia(character),
  };
}
