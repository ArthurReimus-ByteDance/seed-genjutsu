import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { env } from "@/env";
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const ok = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
export function sameOrigin(request: Request) {
  const configured = new URL(env.APP_URL);
  const allowed = new Set(["localhost", "127.0.0.1", "[::1]"]);
  const target = new URL(request.url);
  const host = new URL(
    target.protocol + "//" + (request.headers.get("host") ?? target.host),
  );
  if (!allowed.has(host.hostname) || host.port !== configured.port)
    throw new AppError(403, "LOCAL_ONLY", "Open this studio on localhost.");
  const origin = request.headers.get("origin");
  let originAllowed = !origin;
  if (origin) {
    try {
      const source = new URL(origin);
      originAllowed =
        allowed.has(source.hostname) &&
        source.port === configured.port &&
        source.protocol === configured.protocol;
    } catch {
      originAllowed = false;
    }
  }
  if (
    !originAllowed ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    throw new AppError(
      403,
      "ORIGIN_DENIED",
      "This request must come from your studio.",
    );
  }
}
export async function route(
  action: () => Promise<Response>,
  request?: Request,
) {
  try {
    if (request) sameOrigin(request);
    return await action();
  } catch (error) {
    if (error instanceof ZodError)
      return ok(
        {
          error: {
            code: "VALIDATION",
            message: error.issues[0]?.message ?? "Check the request.",
          },
        },
        400,
      );
    if (error instanceof AppError)
      return ok(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    console.error(
      JSON.stringify({
        level: "error",
        message: "Request failed",
        kind: error instanceof Error ? error.name : "unknown",
      }),
    );
    return ok(
      {
        error: {
          code: "INTERNAL",
          message: "Something went wrong. Please try again.",
        },
      },
      500,
    );
  }
}
async function readBody(request: Request, limit: number) {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    const declared = request.headers.get("content-length");
    if (declared != null && !/^\d+$/.test(declared))
      throw new AppError(400, "INVALID_LENGTH", "Send a valid content length.");
    if (declared != null && Number(declared) > limit) {
      try {
        await reader?.cancel();
      } finally {
        throw new AppError(413, "TOO_LARGE", "Request is too large.");
      }
    }
    while (reader) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > limit) {
        try {
          await reader.cancel();
        } finally {
          throw new AppError(413, "TOO_LARGE", "Request is too large.");
        }
      }
      chunks.push(chunk.value);
    }
    const data = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return data;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      400,
      "INVALID_BODY",
      "The request body could not be read.",
    );
  } finally {
    reader?.releaseLock();
  }
}
export async function readJson(request: Request) {
  const data = await readBody(request, 32000);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch {
    throw new AppError(400, "INVALID_JSON", "Send a valid JSON request.");
  }
}
export async function readFormData(
  request: Request,
  limit = 105 * 1024 * 1024,
) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data(?:;|$)/i.test(contentType))
    throw new AppError(
      415,
      "INVALID_CONTENT_TYPE",
      "Send a multipart file upload.",
    );
  const data = await readBody(request, limit);
  try {
    return await new Response(data, {
      headers: { "content-type": contentType },
    }).formData();
  } catch {
    throw new AppError(
      400,
      "INVALID_MULTIPART",
      "Send a valid multipart file upload.",
    );
  }
}
