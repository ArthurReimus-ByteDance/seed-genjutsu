import { readFile } from "node:fs/promises";
import { z } from "zod";
import { getMedia, localPath, providerUrl } from "@/server/storage";
import { route, AppError } from "@/server/http";
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
    const data = await readFile(await localPath(media));
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
    const range = request.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match)
        throw new AppError(416, "INVALID_RANGE", "Invalid media range.");
      const start = match[1]
        ? Number(match[1])
        : Math.max(0, data.length - Number(match[2]));
      const end =
        match[1] && match[2]
          ? Math.min(Number(match[2]), data.length - 1)
          : data.length - 1;
      if (start > end || start >= data.length)
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": "bytes */" + data.length },
        });
      return new Response(new Uint8Array(data.subarray(start, end + 1)), {
        status: 206,
        headers: {
          ...headers,
          "Content-Range": "bytes " + start + "-" + end + "/" + data.length,
          "Content-Length": String(end - start + 1),
        },
      });
    }
    return new Response(new Uint8Array(data), {
      headers: { ...headers, "Content-Length": String(data.length) },
    });
  }, request);
