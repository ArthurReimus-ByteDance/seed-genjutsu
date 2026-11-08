import { z } from "zod";
import {
  DEFAULT_VIDEO_MODEL,
  LEGACY_VIDEO_MODEL,
  videoModelIds,
  videoModels,
  type VideoModelId,
} from "./video-models";
export const uploadSchema = z.object({
  id: z.uuid(),
  kind: z.enum([
    "video",
    "character",
    "frame",
    "anchor",
    "masked",
    "result",
    "prepared",
  ]),
  name: z.string(),
  mime: z.string(),
  bytes: z.number(),
  duration: z.number().nullable(),
  width: z.number(),
  height: z.number(),
  url: z.string(),
  posterUrl: z.string().nullable(),
});
export type Upload = z.infer<typeof uploadSchema>;
function jobConfigSchema(defaultModel: VideoModelId) {
  return z
    .object({
      model: z.enum(videoModelIds).default(defaultModel),
      sourceId: z.uuid(),
      characterId: z.uuid(),
      prompt: z
        .string()
        .trim()
        .min(10, "Describe the character swap in at least 10 characters.")
        .max(3000),
      target: z.string().trim().min(1).max(160).default("person"),
      start: z.number().min(0).max(300).default(0),
      duration: z.number().min(4).max(30),
      resolution: z.enum(["480p", "720p", "1080p"]).default("720p"),
      prepareImage: z.boolean().default(false),
      preserveAudio: z.boolean().default(true),
      reviewBeforeGeneration: z.boolean().default(true),
    })
    .superRefine((config, context) => {
      if (
        config.duration > videoModels[config.model].maxDuration ||
        (config.model === "seedance-2" && !Number.isInteger(config.duration))
      )
        context.addIssue({
          code: "custom",
          path: ["duration"],
          message:
            config.model === "seedance-2"
              ? "Seedance 2 needs a whole-second clip between 4 and 15 seconds."
              : "Seedance 2.5 supports clips between 4 and 30 seconds.",
        });
    });
}
export const createJobSchema = jobConfigSchema(DEFAULT_VIDEO_MODEL);
export const generationPromptSchema = z.object({
  prompt: createJobSchema.shape.prompt,
});
// Takes saved before the picker were submitted with Seedance 2.5.
export const savedJobConfigSchema = jobConfigSchema(LEGACY_VIDEO_MODEL);
export type CreateJob = z.infer<typeof createJobSchema>;
export const jobStatusSchema = z.enum([
  "queued",
  "processing",
  "awaiting_approval",
  "generating",
  "succeeded",
  "failed",
  "cancelled",
  "needs_attention",
]);
export const eventSchema = z.object({
  id: z.coerce.number(),
  stage: z.string(),
  message: z.string(),
  createdAt: z.string(),
});
export const jobSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  prompt: z.string(),
  status: jobStatusSchema,
  stage: z.string(),
  progress: z.number(),
  config: savedJobConfigSchema,
  source: uploadSchema,
  character: uploadSchema,
  frame: uploadSchema.nullable(),
  anchor: uploadSchema.nullable(),
  masked: uploadSchema.nullable(),
  result: uploadSchema.nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  events: z.array(eventSchema),
});
export type Job = z.infer<typeof jobSchema>;
export const capabilitySchema = z.object({
  video: z.boolean(),
  image: z.boolean(),
  storage: z.boolean(),
  portraits: z.boolean(),
  sam: z.boolean(),
  promptEnhancement: z.boolean(),
  promptEnhancerModel: z.string().nullable(),
  seedanceModel: z.string(),
  defaultVideoModel: z.enum(videoModelIds),
  seedreamModel: z.string().nullable(),
  missing: z.array(z.string()),
  workerSeenAt: z.string().nullable(),
});
export type Capabilities = z.infer<typeof capabilitySchema>;
export const terminal = (status: string) =>
  [
    "succeeded",
    "failed",
    "cancelled",
    "needs_attention",
    "awaiting_approval",
  ].includes(status);
