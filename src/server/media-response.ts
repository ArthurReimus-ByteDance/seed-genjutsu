import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import { parseByteRange } from "@/lib/byte-range";
import { AppError } from "./http";

export async function fileResponse(
  request: Request,
  file: string,
  headers: Record<string, string> = {},
) {
  const handle = await open(file, "r").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT")
      throw new AppError(404, "FILE_MISSING", "Media file is unavailable.");
    throw error;
  });
  try {
    const { size } = await handle.stat();
    const range = request.headers.get("range");
    const bounds = range
      ? parseByteRange(range, size)
      : { start: 0, end: size - 1 };
    const responseHeaders = {
      ...headers,
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
    };
    if (!bounds) {
      await handle.close();
      return new Response(null, {
        status: 416,
        headers: { ...responseHeaders, "Content-Range": "bytes */" + size },
      });
    }
    if (!size) {
      await handle.close();
      return new Response(null, {
        headers: { ...responseHeaders, "Content-Length": "0" },
      });
    }
    const stream = handle.createReadStream({
      ...bounds,
      autoClose: true,
      highWaterMark: 65536,
      signal: request.signal,
    });
    const body = Readable.toWeb(stream, {
      strategy: {
        highWaterMark: 65536,
        size: (chunk: Uint8Array) => chunk.byteLength,
      },
    }) as ReadableStream<Uint8Array>;
    return new Response(body, {
      status: range ? 206 : 200,
      headers: {
        ...responseHeaders,
        "Content-Length": String(bounds.end - bounds.start + 1),
        ...(range
          ? { "Content-Range": `bytes ${bounds.start}-${bounds.end}/${size}` }
          : {}),
      },
    });
  } catch (error) {
    await handle.close();
    throw error;
  }
}
