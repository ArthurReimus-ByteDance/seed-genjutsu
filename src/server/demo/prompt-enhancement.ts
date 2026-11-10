import {
  enhancePromptRequestSchema,
  promptEnhancementSchema,
} from "@/lib/prompt-enhancement";
import { AppError } from "../http";
import { effectiveDirection } from "@/lib/workflows";

export function demoEnhancement(input: unknown, scenario: string | null) {
  const config = enhancePromptRequestSchema.parse(input);
  if (scenario === "failure")
    throw new AppError(
      502,
      "PROMPT_PROVIDER",
      "Simulated enhancement failure. Your original prompt is unchanged. Retry with the successful scenario.",
    );
  const opening =
    config.workflow === "element_edit"
      ? "Edit Video 1 as directed, retaining unrelated identities and elements."
      : config.workflow === "motion_transfer"
        ? "Create a new video using Video 1 for movement and camera, with the supplied cast or scene references."
        : config.workflow === "restyle"
          ? "Restyle Video 1 consistently while retaining its subjects, motion, and composition."
          : config.model === "seedance-2.5"
            ? "Edit Video 1: replace the selected subject with the character from Image 1."
            : "Recreate the performance from Video 1 using the character from Image 1.";
  const ending =
    config.workflow !== "character_swap"
      ? config.previousPrompt
        ? "Keep the requested transformation consistent over time, honoring source-motion constraints and explicit exceptions."
        : "Honor explicit changes without changing unrelated elements."
      : config.previousPrompt
        ? "Keep the character coherent across the clip while following the source gestures, framing and scene lighting."
        : "Preserve the source performance, camera movement, background, lighting and timing, keeping the replacement character consistent throughout.";
  const prompt = [
    opening,
    effectiveDirection(config),
    ending,
    config.prepareImage
      ? "Use Image 2 as an appearance and composition reference."
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  return promptEnhancementSchema.parse({
    prompt: prompt.slice(0, 3000),
    model: "Preview · simulated",
    simulated: true,
  });
}
