import { z } from "zod";

export const workflowIds = [
  "character_swap",
  "element_edit",
  "motion_transfer",
  "restyle",
] as const;
export type WorkflowId = (typeof workflowIds)[number];
export const workflows = {
  character_swap: {
    label: "Character Swap",
    description: "Replace a tracked subject with a character reference.",
    placeholder:
      "Replace the selected dancer with Image 1, keeping the source performance.",
  },
  element_edit: {
    label: "Edit Elements",
    description:
      "Change objects, wardrobe, text, or locations in the original clip.",
    placeholder:
      "Change the selected jacket to red. Keep the person, motion, and surroundings.",
  },
  motion_transfer: {
    label: "Motion Transfer",
    description: "Use the source movement to animate a new cast or scene.",
    placeholder:
      "Animate the character in Image 1 using the movement and camera from Video 1.",
  },
  restyle: {
    label: "Restyle",
    description:
      "Redraw the original clip with a preset, style image, or custom direction.",
    placeholder:
      "Restyle the whole clip as hand-painted animation, retaining its motion and composition.",
  },
} as const;

export const referenceRoles = [
  "character",
  "identity",
  "garment",
  "object",
  "scene",
  "style",
] as const;
export type ReferenceRole = (typeof referenceRoles)[number];
export const referenceSchema = z
  .object({
    id: z.uuid(),
    mediaId: z.uuid(),
    role: z.enum(referenceRoles),
  })
  .strict();
export type ReferenceInput = z.infer<typeof referenceSchema>;

export const stylePresetIds = [
  "custom",
  "watercolor",
  "anime",
  "clay",
  "noir",
  "pixel_art",
] as const;
export type StylePresetId = (typeof stylePresetIds)[number];
export const stylePresets = {
  custom: { label: "Custom direction / reference", direction: "" },
  watercolor: {
    label: "Watercolor",
    direction:
      "Restyle the entire clip as hand-painted watercolor with paper texture, soft pigment edges, and consistent painted detail across frames.",
  },
  anime: {
    label: "Anime",
    direction:
      "Restyle the entire clip as cel-shaded animation with clean drawn outlines and consistent illustrated characters and backgrounds.",
  },
  clay: {
    label: "Clay animation",
    direction:
      "Restyle the entire clip as sculpted clay animation with tactile surfaces and consistent handmade characters and scenery.",
  },
  noir: {
    label: "Film noir",
    direction:
      "Restyle the entire clip in monochrome film-noir imagery with dramatic chiaroscuro lighting and consistent fine film grain.",
  },
  pixel_art: {
    label: "Pixel art",
    direction:
      "Restyle the entire clip as deliberately pixelated animation with a limited color palette and stable pixel-grid detail.",
  },
} as const;
export const STYLE_PRESET_REVISION = 1;

export function effectiveDirection(config: {
  workflow?: WorkflowId;
  prompt: string;
  stylePreset?: StylePresetId;
  references?: { role: ReferenceRole }[];
}) {
  const style =
    config.workflow === "restyle"
      ? stylePresets[config.stylePreset ?? "custom"].direction
      : "";
  const direction = [style, config.prompt.trim()].filter(Boolean).join(" ");
  if (direction) return direction;
  return config.workflow === "restyle" &&
    config.references?.some((reference) => reference.role === "style")
    ? "Restyle the original clip using the supplied style references."
    : "";
}

export function registrationMediaId(job: {
  config: { workflow?: WorkflowId };
  prepared_id: string | null;
  masked_id: string | null;
}) {
  return (job.config.workflow ?? "character_swap") === "character_swap"
    ? job.masked_id
    : job.prepared_id;
}
