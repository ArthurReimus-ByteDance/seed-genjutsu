import { z } from "zod";
import { getMedia, localPath, providerUrl } from "@/server/storage";
import { route } from "@/server/http";
import { fileResponse } from "@/server/media-response";
import { env } from "@/env";
export const GET = (
  request: Request,
  context: { params: Promise<{ id: string }> },
) =>
  route(async () => {
    const { id } = await context.params;
    z.uuid().parse(id);
    const media = await getMedia(id);
    const download = new URL(request.url).searchParams.has("download");
    if (env.STORAGE_MODE === "tos")
      return new Response(null, {
        status: 307,
        headers: {
          Location: await providerUrl(media, download),
          "Cache-Control": "private, no-store",
        },
      });
    const headers: Record<string, string> = {
      "Content-Type": media.mime,
      "Cache-Control": "private, no-store",
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
    };
    if (download)
      headers["Content-Disposition"] =
        'attachment; filename="' +
        media.name.replace(/[^a-zA-Z0-9._-]/g, "_") +
        '"';
    return fileResponse(request, await localPath(media), headers);
  }, request);
