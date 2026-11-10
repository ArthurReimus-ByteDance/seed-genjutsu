import { workerSeenAt } from "@/server/workspace";
import { ok, route } from "@/server/http";
import { env } from "@/env";
import { DEFAULT_VIDEO_MODEL } from "@/lib/video-models";
import { providerModelId } from "@/server/video-models";
import { workflowIds, workflows } from "@/lib/workflows";
export const dynamic = "force-dynamic";
export const GET = (request: Request) =>
  route(async () => {
    const sam = !!env.META_API_KEY;
    const storage =
      env.STORAGE_MODE === "tos" &&
      !!env.TOS_BUCKET &&
      !!env.BYTEPLUS_ACCESS_KEY &&
      !!env.BYTEPLUS_SECRET_KEY;
    const portraits = !!env.BYTEPLUS_ACCESS_KEY && !!env.BYTEPLUS_SECRET_KEY;
    const video = !!env.BYTEPLUS_API_KEY;
    return ok({
      workflows: workflowIds.map((id) => ({
        id,
        label: workflows[id].label,
        model: id === "character_swap" ? null : "seedance-2.5",
        requiresSam: id === "character_swap",
        maxImageReferences: id === "character_swap" ? 1 : 30,
        configured:
          video && storage && portraits && (id !== "character_swap" || sam),
        qualityValidated: false,
      })),
      video,
      image: !!env.SEEDREAM_MODEL && video,
      storage,
      portraits,
      sam,
      samVerification: video && sam,
      samVerifierModel: video && sam ? env.SAM_VERIFIER_MODEL : null,
      promptEnhancement: video,
      promptEnhancerModel: video ? env.PROMPT_ENHANCER_MODEL : null,
      seedanceModel: providerModelId(DEFAULT_VIDEO_MODEL),
      defaultVideoModel: DEFAULT_VIDEO_MODEL,
      seedreamModel: env.SEEDREAM_MODEL ?? null,
      missing: [
        !sam ? "Meta SAM 3.1 API key" : null,
        !portraits ? "Virtual Portrait access keys" : null,
        !storage ? "Media object storage" : null,
        !video ? "ModelArk API key" : null,
      ].filter(Boolean),
      workerSeenAt: await workerSeenAt(),
    });
  }, request);
