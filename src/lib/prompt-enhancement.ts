import { z } from "zod";
import { videoModelIds } from "./video-models";
import { generationPromptSchema } from "./schemas";
import { workflowIds, stylePresetIds, referenceRoles } from "./workflows";

export const enhancePromptRequestSchema = z
  .object({
    prompt: z.string().trim().min(3, "Add a few words to enhance.").max(3000),
    model: z.enum(videoModelIds),
    workflow: z.enum(workflowIds).default("character_swap"),
    operation: z.enum(["replace", "add", "remove", "modify"]).default("modify"),
    stylePreset: z.enum(stylePresetIds).default("custom"),
    references: z
      .array(z.object({ role: z.enum(referenceRoles) }).strict())
      .max(30)
      .default([]),
    target: z.string().trim().min(1).max(160),
    prepareImage: z.boolean(),
    preserveAudio: z.boolean(),
    previousPrompt: z.string().trim().max(3000).optional(),
  })
  .strict();

export const promptSuggestionSchema = z
  .object({ prompt: generationPromptSchema.shape.prompt })
  .strict();

export const promptEnhancementSchema = promptSuggestionSchema.extend({
  model: z.string().min(1),
  simulated: z.boolean(),
});

export type EnhancePromptRequest = z.infer<typeof enhancePromptRequestSchema>;
export type PromptEnhancement = z.infer<typeof promptEnhancementSchema>;
