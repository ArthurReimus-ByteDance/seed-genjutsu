import {
  stylePresetIds,
  stylePresets,
  STYLE_PRESET_REVISION,
} from "@/lib/workflows";
import { AppError, ok, route } from "@/server/http";

export const dynamic = "force-dynamic";
export const GET = (request: Request) =>
  route(async () => {
    const workflow = new URL(request.url).searchParams.get("workflow");
    if (workflow && workflow !== "restyle")
      throw new AppError(
        400,
        "INVALID_WORKFLOW",
        "Style presets are available for the restyle workflow.",
      );
    return ok({
      presets: stylePresetIds.map((id) => ({
        id,
        revision: STYLE_PRESET_REVISION,
        ...stylePresets[id],
        qualityValidated: false,
      })),
    });
  }, request);
