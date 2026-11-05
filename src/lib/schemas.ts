import { z } from "zod";
export const userSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
});
export type User = z.infer<typeof userSchema>;
export const credentialsSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(12, "Use at least 12 characters.").max(128),
  name: z.string().trim().min(2).max(80).optional(),
  inviteCode: z.string().max(200).optional(),
});
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
export const createJobSchema = z.object({
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
});
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
  config: createJobSchema,
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
  seedanceModel: z.string(),
  seedreamModel: z.string().nullable(),
  registration: z.boolean(),
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
