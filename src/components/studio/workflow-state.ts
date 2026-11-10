import type { Capabilities, CreateJob, Job, Upload } from "@/lib/schemas";
import type { VideoModelId } from "@/lib/video-models";
import {
  effectiveDirection,
  type StylePresetId,
  type WorkflowId,
} from "@/lib/workflows";

export type StudioReference = Job["references"][number];
export type WorkflowContext = {
  workflow: WorkflowId;
  operation: CreateJob["operation"];
  stylePreset: StylePresetId;
  references: StudioReference[];
};

export function switchDirection(
  draft: {
    workflow: WorkflowId;
    prompt: string;
    directions: Partial<Record<WorkflowId, string>>;
  },
  workflow: WorkflowId,
) {
  const directions = { ...draft.directions, [draft.workflow]: draft.prompt };
  return { workflow, directions, prompt: directions[workflow] ?? "" };
}

export function moveReference(
  references: StudioReference[],
  id: string,
  offset: -1 | 1,
) {
  const index = references.findIndex((reference) => reference.id === id);
  const destination = index + offset;
  if (index < 0 || destination < 0 || destination >= references.length)
    return references;
  const ordered = [...references];
  [ordered[index], ordered[destination]] = [
    ordered[destination],
    ordered[index],
  ];
  return ordered;
}

export function workflowSettings({
  workflow,
  model,
  prepareImage,
  character,
  references,
}: {
  workflow: WorkflowId;
  model: VideoModelId;
  prepareImage: boolean;
  character: Upload | null;
  references: StudioReference[];
}) {
  const swap = workflow === "character_swap";
  return {
    workflow,
    model: swap ? model : ("seedance-2.5" as const),
    prepareImage: swap && prepareImage,
    ...(swap && character ? { characterId: character.id } : {}),
    references: swap
      ? []
      : references.map(({ id, role, media }) => ({
          id,
          role,
          mediaId: media.id,
        })),
  };
}

export function workflowConnected(
  capabilities: Capabilities | undefined,
  workflow: WorkflowId,
  prepareImage = false,
) {
  if (!capabilities) return false;
  return !!(
    capabilities.video &&
    capabilities.storage &&
    capabilities.portraits &&
    capabilities.workerSeenAt &&
    (workflow !== "character_swap" ||
      (capabilities.sam && (!prepareImage || capabilities.image)))
  );
}

export function workflowInputIssue({
  workflow,
  source,
  character,
  references,
  prompt,
  stylePreset,
}: {
  workflow: WorkflowId;
  source: Upload | null;
  character: Upload | null;
  references: StudioReference[];
  prompt: string;
  stylePreset: StylePresetId;
}) {
  if (!source) return "Add a source video to begin.";
  if (workflow === "character_swap" && !character)
    return "Add a character image to continue.";
  if (
    workflow === "motion_transfer" &&
    !references.some(({ role }) =>
      ["character", "identity", "scene"].includes(role),
    )
  )
    return "Add a character, identity, or scene image for motion transfer.";
  if (
    effectiveDirection({ workflow, prompt, stylePreset, references }).length <
    10
  )
    return workflow === "restyle"
      ? "Choose a preset, add a style image, or describe the restyle in at least 10 characters."
      : "Describe the change in at least 10 characters.";
  return null;
}

export function enhancementContextKey(context: WorkflowContext) {
  return JSON.stringify({
    workflow: context.workflow,
    operation: context.operation,
    stylePreset: context.stylePreset,
    references: context.references.map(({ id, role, media }) => ({
      id,
      role,
      mediaId: media.id,
    })),
  });
}

export function reviewMedia(job: Job) {
  return job.config.workflow === "character_swap" ? job.masked : job.prepared;
}
