import { requireUser } from "@/server/auth";
import { sql } from "@/server/db";
import { ok, route } from "@/server/http";
import { env } from "@/env";
export const GET = () =>
  route(async () => {
    await requireUser();
    const sam = !!env.FAL_KEY && !!env.FAL_SAM_ENDPOINT;
    const storage =
      env.STORAGE_MODE === "tos" &&
      !!env.TOS_BUCKET &&
      !!env.TOS_ACCESS_KEY &&
      !!env.TOS_SECRET_KEY;
    const portraits = !!env.BYTEPLUS_ACCESS_KEY && !!env.BYTEPLUS_SECRET_KEY;
    const video = !!env.BYTEPLUS_API_KEY;
    const beats = await sql(
      "SELECT max(seen_at) AS seen FROM worker_heartbeats WHERE seen_at>now()-interval '30 seconds'",
    );
    return ok({
      video,
      image: !!env.SEEDREAM_MODEL && video,
      storage,
      portraits,
      sam,
      seedanceModel: env.SEEDANCE_MODEL,
      seedreamModel: env.SEEDREAM_MODEL ?? null,
      registration: env.REGISTRATION_ENABLED === "true",
      missing: [
        !sam ? "fal.ai SAM connection" : null,
        !portraits ? "Virtual Portrait access keys" : null,
        !storage ? "Media object storage" : null,
        !video ? "ModelArk API key" : null,
      ].filter(Boolean),
      workerSeenAt: beats[0].seen?.toISOString() ?? null,
    });
  });
