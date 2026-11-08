import { env } from "@/env";
import type { VideoModelId } from "@/lib/video-models";

export function providerModelId(model: VideoModelId) {
  return model === "seedance-2" ? env.SEEDANCE_2_MODEL : env.SEEDANCE_2_5_MODEL;
}
