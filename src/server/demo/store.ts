import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { env } from "@/env";
import { AppError } from "@/server/http";
import { jobSchema, uploadSchema, type Upload } from "@/lib/schemas";
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
      masked: uploadSchema,
      anchor: uploadSchema,
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
