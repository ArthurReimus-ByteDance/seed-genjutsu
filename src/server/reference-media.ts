import type { Upload } from "@/lib/schemas";
import { AppError } from "./http";

type ReferenceMedia = Pick<
  Upload,
  "kind" | "mime" | "bytes" | "width" | "height" | "duration"
>;

function validateDimensions(
  media: ReferenceMedia,
  minimum: number,
  maximum: number,
  enforceProviderRatio = true,
) {
  const ratio = media.width / media.height;
  if (
    !Number.isInteger(media.width) ||
    !Number.isInteger(media.height) ||
    media.width < minimum ||
    media.height < minimum ||
    media.width > maximum ||
    media.height > maximum ||
    (enforceProviderRatio && (ratio < 0.4 || ratio > 2.5)) ||
    !Number.isSafeInteger(media.bytes) ||
    media.bytes <= 0
  )
    throw new AppError(
      400,
      "INVALID_MEDIA",
      "The reference dimensions, aspect ratio or file size are unsupported.",
    );
}

export function validateSourceVideo(
  media: ReferenceMedia,
  start: number,
  duration: number,
) {
  validateDimensions(media, 1, 36_000_000, false);
  if (
    media.kind !== "video" ||
    !["video/mp4", "video/quicktime"].includes(media.mime) ||
    !media.duration ||
    !Number.isFinite(media.duration) ||
    media.width * media.height > 36_000_000 ||
    media.bytes > 250 * 1024 * 1024
  )
    throw new AppError(400, "INVALID_INPUT", "Choose a valid source video.");
  if (start + duration > media.duration + 0.06)
    throw new AppError(
      400,
      "INVALID_TRIM",
      "The selected range extends past the video.",
    );
}

export function validateReferenceImage(
  media: ReferenceMedia,
  kind: "character" | "anchor",
) {
  validateDimensions(media, 300, 6000);
  if (
    media.kind !== kind ||
    !["image/jpeg", "image/png", "image/webp"].includes(media.mime) ||
    media.duration !== null ||
    media.bytes >= 30 * 1024 * 1024
  )
    throw new AppError(
      400,
      "INVALID_IMAGE_REFERENCE",
      "Choose a supported reference image smaller than 30 MB.",
    );
}

export function validateReferenceVideo(
  media: ReferenceMedia,
  kind: "prepared" | "masked",
  duration: number,
) {
  validateDimensions(media, 300, 6000);
  const pixels = media.width * media.height;
  if (
    media.kind !== kind ||
    media.mime !== "video/mp4" ||
    media.bytes > 200 * 1024 * 1024 ||
    pixels < 407696 ||
    pixels > 8295044 ||
    !media.duration ||
    !Number.isFinite(media.duration) ||
    media.duration < 4 - 0.06 ||
    media.duration > duration + 0.06
  )
    throw new AppError(
      400,
      "INVALID_VIDEO_REFERENCE",
      "The prepared video exceeds this model's media, size, dimensions or duration limits.",
    );
}
