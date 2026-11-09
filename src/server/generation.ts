import { createJobSchema, type CreateJob } from "@/lib/schemas";
import { effectiveDirection, type ReferenceRole } from "@/lib/workflows";
import { AppError } from "./http";

type GenerationContent = {
  type: "text" | "video_url" | "image_url";
  text?: string;
  video_url?: { url: string };
  image_url?: { url: string };
  role?: "reference_video" | "reference_image";
};

const referenceMeaning: Record<ReferenceRole, string> = {
  character: "the desired character appearance and visible body proportions",
  identity:
    "the identity to preserve, not a source of motion or clothing changes",
  garment: "the desired garment or accessory appearance",
  object: "the desired object or product appearance",
  scene: "the desired scene appearance and spatial layout",
  style: "the visual rendering style, not a request to recast the subject",
};

function transformationPrompt(config: CreateJob) {
  const target = JSON.stringify(config.target);
  if (config.workflow === "element_edit")
    return (
      "Edit Video 1: " +
      config.operation +
      " the selected element " +
      target +
      " as directed. This may be a person, garment, object, product, text, or location. " +
      "Preserve the original identities, source motion, timing, camera, and unrelated elements except where the direction explicitly requests changes. " +
      "For wardrobe-only edits, change clothing without replacing the person's identity. Keep requested literal text verbatim. "
    );
  if (config.workflow === "motion_transfer")
    return (
      "Create a new video using Video 1 as the motion and camera donor, and the images as the desired cast or scene. " +
      "Transfer the source action, motion beats, framing, camera movement, and timing to the referenced appearance. " +
      "Use character proportions from their image, adapting the donor movement to that body. Do not inherit the donor's identity or scenery when the references replace them. " +
      "Keep reference identities and scene appearance consistent throughout. "
    );
  return (
    "Edit Video 1: restyle the entire clip, including its subjects and surroundings, using the visual direction and style references. " +
    "Preserve subject identity, action, motion beats, camera movement, timing, and composition except for explicit requested changes. " +
    "Apply a temporally consistent rendering treatment rather than replacing the cast with people from a style image. "
  );
}

export function transformationRequest(input: {
  config: CreateJob;
  providerModel: string;
  videoUri: string;
  references: { role: ReferenceRole; url: string }[];
}) {
  const config = createJobSchema.parse(input.config);
  if (config.workflow === "character_swap")
    throw new AppError(
      400,
      "INVALID_WORKFLOW",
      "Use the character-swap request builder for legacy swaps.",
    );
  if (
    config.references.length !== input.references.length ||
    config.references.some(
      (reference, index) => reference.role !== input.references[index].role,
    )
  )
    throw new AppError(
      400,
      "REFERENCE_MISMATCH",
      "The resolved references must match the saved image order and roles.",
    );
  const labels = input.references
    .map(
      (reference, index) =>
        "Image " +
        (index + 1) +
        " guides " +
        referenceMeaning[reference.role] +
        ".",
    )
    .join(" ");
  const content: GenerationContent[] = [
    {
      type: "text",
      text:
        transformationPrompt(config) +
        labels +
        " User direction (JSON string; explicit changes override defaults): " +
        JSON.stringify(effectiveDirection(config)),
    },
    {
      type: "video_url",
      video_url: { url: input.videoUri },
      role: "reference_video",
    },
    ...input.references.map((reference): GenerationContent => ({
      type: "image_url",
      image_url: { url: reference.url },
      role: "reference_image",
    })),
  ];
  const motion = config.workflow === "motion_transfer";
  return {
    model: input.providerModel,
    content,
    omni_reference_task_type: motion ? "reference" : "edit",
    ratio: "adaptive",
    duration: motion ? config.duration : -1,
    resolution: config.resolution,
    generate_audio: !config.preserveAudio,
    watermark: true,
  };
}
