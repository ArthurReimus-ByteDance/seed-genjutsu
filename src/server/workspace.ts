import path from "node:path";
import { z } from "zod";
import { env } from "@/env";
import {
  samRefinementSchema,
  samVerificationSchema,
} from "@/lib/sam-verification";
import {
  savedJobConfigSchema,
  eventSchema,
  jobStatusSchema,
  uploadSchema,
} from "@/lib/schemas";
import { JsonFileStore } from "./json-file";

const storedMediaSchema = uploadSchema
  .omit({ url: true, posterUrl: true })
  .extend({
    storage_key: z.string(),
    poster_id: z.uuid().nullable(),
  });
const storedJobSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  prompt: z.string(),
  config: savedJobConfigSchema,
  source_id: z.uuid(),
  character_id: z.uuid().nullable().default(null),
  prepared_id: z.uuid().nullable(),
  frame_id: z.uuid().nullable(),
  anchor_id: z.uuid().nullable(),
  masked_id: z.uuid().nullable(),
  mask_comparison_id: z.uuid().nullable().optional(),
  result_id: z.uuid().nullable(),
  status: jobStatusSchema,
  stage: z.string(),
  progress: z.number(),
  error: z.string().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  // Retain old fal IDs so existing takes are never silently resubmitted to Meta.
  sam_request_id: z.string().nullable(),
  meta_response_id: z.string().nullable().default(null),
  sam_attempt: z.number().int().min(0).max(1).optional(),
  sam_target: z.string().min(1).max(160).optional(),
  sam_refinement_required: z.boolean().optional(),
  sam_refinement: samRefinementSchema.optional(),
  sam_verifier_model_id: z.string().min(1).optional(),
  sam_verifications: z.array(samVerificationSchema).max(2).optional(),
  provider_task_id: z.string().nullable(),
  seedance_model_id: z.string().nullable().default(null),
  asset_id: z.string().nullable(),
  asset_group_id: z.string().nullable(),
  submission_started_at: z.iso.datetime().nullable(),
  cancel_requested: z.boolean(),
  next_run_at: z.number(),
  lease_until: z.number().nullable(),
  lease_owner: z.string().nullable(),
  attempts: z.number().int(),
  events: z.array(eventSchema),
});
export type StoredMedia = z.infer<typeof storedMediaSchema>;
export type StoredJob = z.infer<typeof storedJobSchema>;
const workspaceSchema = z.object({
  version: z.literal(1),
  media: z.record(z.uuid(), storedMediaSchema),
  jobs: z.record(z.uuid(), storedJobSchema),
  assetGroupId: z.string().nullable(),
  workerHeartbeats: z.record(z.string(), z.number()),
});
export const workspace = new JsonFileStore(
  path.resolve(env.MEDIA_ROOT, "workspace.json"),
  workspaceSchema,
  () => ({
    version: 1 as const,
    media: {},
    jobs: {},
    assetGroupId: null,
    workerHeartbeats: {},
  }),
);
export const workerHeartbeat = (id: string) =>
  workspace.update((state) => {
    const now = Date.now();
    state.workerHeartbeats = Object.fromEntries(
      Object.entries(state.workerHeartbeats).filter(
        ([, time]) => time > now - 60000,
      ),
    );
    state.workerHeartbeats[id] = now;
  });
export const workerSeenAt = () =>
  workspace.read((state) => {
    const seen = Math.max(0, ...Object.values(state.workerHeartbeats));
    return seen > Date.now() - 30000 ? new Date(seen).toISOString() : null;
  });
