import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { requireUser, rateLimit } from "@/server/auth";
import { AppError, ok, route, sameOrigin } from "@/server/http";
import { mediaRoot, saveMedia, publicUpload } from "@/server/storage";
import {
  frame,
  normalizeImage,
  probe,
  referenceDimensions,
} from "@/server/media";
export const runtime = "nodejs";
export const maxDuration = 120;
export const POST = (request: Request) =>
  route(async () => {
    sameOrigin(request);
    const user = await requireUser();
    await rateLimit("upload:" + user.id, 30, 3600);
    if (Number(request.headers.get("content-length") ?? 0) > 105 * 1024 * 1024)
      throw new AppError(413, "TOO_LARGE", "Videos must be under 100 MB.");
    const form = await request.formData();
    const kind = z.enum(["video", "character"]).parse(form.get("kind"));
    const file = form.get("file");
    if (!(file instanceof File) || !file.size)
      throw new AppError(400, "FILE_REQUIRED", "Choose a file to upload.");
    if (file.size > (kind === "video" ? 100 : 20) * 1024 * 1024)
      throw new AppError(
        413,
        "TOO_LARGE",
        kind === "video"
          ? "Videos must be under 100 MB."
          : "Images must be under 20 MB.",
      );
    const data = Buffer.from(await file.arrayBuffer());
    if (kind === "character") {
      const image = await normalizeImage(data);
      const media = await saveMedia({
        userId: user.id,
        kind,
        name: file.name.slice(0, 180),
        mime: "image/jpeg",
        ...image,
      });
      return ok({ upload: publicUpload(media) }, 201);
    }
    await mkdir(mediaRoot, { recursive: true });
    const temporary = path.join(mediaRoot, "upload-" + randomUUID());
    await writeFile(temporary, data);
    try {
      const meta = await probe(temporary);
      referenceDimensions(meta.width, meta.height);
      if (meta.duration < 4 || meta.duration > 300)
        throw new AppError(
          400,
          "VIDEO_DURATION",
          "Choose a source clip between 4 seconds and 5 minutes. You can select up to 30 seconds to edit.",
        );
      const image = await frame(temporary);
      const poster = await saveMedia({
        userId: user.id,
        kind: "frame",
        name: "Source poster",
        mime: "image/jpeg",
        ...image,
      });
      const media = await saveMedia({
        userId: user.id,
        kind,
        name: file.name.slice(0, 180),
        mime: "video/mp4",
        data,
        ...meta,
        posterId: poster.id,
      });
      return ok({ upload: publicUpload(media) }, 201);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  });
