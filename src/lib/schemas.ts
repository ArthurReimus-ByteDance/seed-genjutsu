import { z } from "zod";
import { samRefinementSchema, samVerificationSchema } from "./sam-verification";
import {
  DEFAULT_VIDEO_MODEL,
  LEGACY_VIDEO_MODEL,
  videoModelIds,
  videoModels,
  type VideoModelId,
} from "./video-models";
import {
  referenceSchema,
  workflowIds,
  stylePresetIds,
  effectiveDirection,
  STYLE_PRESET_REVISION,
} from "./workflows";
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
    "verification",
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
      workflow: z.enum(workflowIds).default("character_swap"),
      sourceId: z.uuid(),
      characterId: z.uuid().optional(),
      references: z.array(referenceSchema).max(30).default([]),
      operation: z
        .enum(["replace", "add", "remove", "modify"])
        .default("modify"),
      stylePreset: z.enum(stylePresetIds).default("custom"),
      stylePresetRevision: z
        .literal(STYLE_PRESET_REVISION)
        .default(STYLE_PRESET_REVISION),
      prompt: z.string().trim().max(3000),
      target: z.string().trim().min(1).max(160).default("person"),
      start: z.number().min(0).max(300).default(0),
      duration: z.number().min(4).max(30),
      resolution: z.enum(["480p", "720p", "1080p"]).default("720p"),
      prepareImage: z.boolean().default(false),
      preserveAudio: z.boolean().default(true),
      reviewBeforeGeneration: z.boolean().default(true),
    })
    .superRefine((config, context) => {
      const issue = (path: string, message: string) =>
        context.addIssue({ code: "custom", path: [path], message });
      if (config.workflow === "character_swap") {
        if (!config.characterId)
          issue("characterId", "Choose a replacement character image.");
        if (config.references.length)
          issue("references", "Character swaps use the character image input.");
      } else {
        if (config.model !== "seedance-2.5")
          issue("model", "New workflows require Seedance 2.5.");
        if (config.characterId)
          issue("characterId", "Use ordered references for this workflow.");
        if (config.prepareImage)
          issue(
            "prepareImage",
            "Scene-image preparation is available for character swaps only.",
          );
        if (
          config.workflow === "motion_transfer" &&
          !config.references.some((reference) =>
            ["character", "identity", "scene"].includes(reference.role),
          )
        )
          issue(
            "references",
            "Choose a character, identity, or scene reference for motion transfer.",
          );
      }
      if (effectiveDirection(config).length < 10)
        issue(
          "prompt",
          "Describe the transformation in at least 10 characters, or choose a style preset.",
        );
      const ids = new Set(config.references.map((reference) => reference.id));
      const mediaIds = new Set(
        config.references.map((reference) => reference.mediaId),
      );
      if (
        ids.size !== config.references.length ||
        mediaIds.size !== config.references.length
      )
        issue("references", "Each reference must have a unique ID and image.");
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
const newJobConfigSchema = jobConfigSchema(DEFAULT_VIDEO_MODEL);
export const createJobSchema = z.preprocess((input, context) => {
  if (
    input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    "workflow" in input &&
    input.workflow !== "character_swap"
  ) {
    const keys = Object.keys(input).filter(
      (key) => !Object.hasOwn(newJobConfigSchema.shape, key),
    );
    if (keys.length)
      context.addIssue({ code: "unrecognized_keys", keys, path: [] });
  }
  return input;
}, newJobConfigSchema);
export const generationPromptSchema = z.object({
  prompt: z.string().trim().min(10).max(3000),
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
  character: uploadSchema.nullable(),
  references: z
    .array(
      z.object({
        id: z.uuid(),
        role: referenceSchema.shape.role,
        media: uploadSchema,
      }),
    )
    .default([]),
  prepared: uploadSchema.nullable().default(null),
  frame: uploadSchema.nullable(),
  anchor: uploadSchema.nullable(),
  masked: uploadSchema.nullable(),
  result: uploadSchema.nullable(),
  samRefinement: samRefinementSchema.nullable().optional(),
  maskVerifications: z.array(samVerificationSchema).max(2).optional(),
  maskComparison: uploadSchema.nullable().optional(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  events: z.array(eventSchema),
});
export type Job = z.infer<typeof jobSchema>;
export const capabilitySchema = z.object({
  workflows: z
    .array(
      z.object({
        id: z.enum(workflowIds),
        label: z.string(),
        model: z.enum(videoModelIds).nullable(),
        requiresSam: z.boolean(),
        maxImageReferences: z.number().int(),
        configured: z.boolean(),
        qualityValidated: z.boolean(),
      }),
    )
    .default([]),
  video: z.boolean(),
  image: z.boolean(),
  storage: z.boolean(),
  portraits: z.boolean(),
  sam: z.boolean(),
  samVerification: z.boolean().optional(),
  samVerifierModel: z.string().nullable().optional(),
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
