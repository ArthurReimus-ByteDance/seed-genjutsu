export const videoModelIds = ["seedance-2", "seedance-2.5"] as const;
export type VideoModelId = (typeof videoModelIds)[number];
export const DEFAULT_VIDEO_MODEL: VideoModelId = "seedance-2";
export const LEGACY_VIDEO_MODEL: VideoModelId = "seedance-2.5";

export const videoModels = {
  "seedance-2": {
    label: "Seedance 2",
    description: "Reference generation · testing default",
    maxDuration: 15,
    durationStep: 1,
    providerId: "dreamina-seedance-2-0-260128",
  },
  "seedance-2.5": {
    label: "Seedance 2.5",
    description: "Dedicated video editing",
    maxDuration: 30,
    durationStep: 0.1,
    providerId: "dreamina-seedance-2-5-260628",
  },
} as const;

export function clampClipDuration(
  value: number,
  model: VideoModelId,
  available = 30,
) {
  const duration = Math.max(
    4,
    Math.min(value, videoModels[model].maxDuration, available),
  );
  return model === "seedance-2" ? Math.floor(duration) : duration;
}
