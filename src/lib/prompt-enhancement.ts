import { z } from "zod";
import { videoModelIds } from "./video-models";
import { generationPromptSchema } from "./schemas";

export const enhancePromptRequestSchema = z
  .object({
    prompt: z.string().trim().min(3, "Add a few words to enhance.").max(3000),
    model: z.enum(videoModelIds),
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
