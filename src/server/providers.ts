import { createHash, createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { env } from "@/env";
import { AppError } from "./http";

export class ProviderError extends Error {
  constructor(
    message: string,
    public ambiguous = false,
    public retryable = false,
  ) {
    super(message);
  }
}
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const hmac = (key: string | Buffer, value: string) =>
  createHmac("sha256", key).update(value).digest();
export function signedHeaders(
  action: string,
  body: string,
  now = new Date(),
  credentials: {
    accessKey?: string;
    secretKey?: string;
    sessionToken?: string;
    region: string;
  } = {
    accessKey: env.BYTEPLUS_ACCESS_KEY,
    secretKey: env.BYTEPLUS_SECRET_KEY,
    sessionToken: env.BYTEPLUS_SESSION_TOKEN,
    region: env.BYTEPLUS_REGION,
  },
) {
  if (!credentials.accessKey || !credentials.secretKey)
    throw new AppError(
      503,
      "PORTRAIT_SETUP",
      "Virtual Portrait access keys are not configured.",
    );
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const short = date.slice(0, 8);
  const host = "ark.ap-southeast-1.byteplusapi.com";
  const headers: Record<string, string> = {
    "content-type": "application/json",
    host: host,
    "x-content-sha256": sha(body),
    "x-date": date,
  };
  if (credentials.sessionToken)
    headers["x-security-token"] = credentials.sessionToken;
  const keys = Object.keys(headers).sort();
  const names = keys.join(";");
  const query = "Action=" + encodeURIComponent(action) + "&Version=2024-01-01";
  const canonical = [
    "POST",
    "/",
    query,
    keys.map((k) => k + ":" + headers[k].trim() + "\n").join(""),
    names,
    sha(body),
  ].join("\n");
  const scope = short + "/" + credentials.region + "/ark/request";
  let key: Buffer = Buffer.from(credentials.secretKey);
  for (const part of [short, credentials.region, "ark", "request"])
    key = hmac(key, part);
  headers.Authorization =
    "HMAC-SHA256 Credential=" +
    credentials.accessKey +
    "/" +
    scope +
    ", SignedHeaders=" +
    names +
    ", Signature=" +
    hmac(key, ["HMAC-SHA256", date, scope, sha(canonical)].join("\n")).toString(
      "hex",
    );
  return headers;
}
export async function arkAction(
  action: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const body = JSON.stringify({ ...input, ProjectName: env.BYTEPLUS_PROJECT });
  return providerRequest(
    "https://ark.ap-southeast-1.byteplusapi.com/?Action=" +
      action +
      "&Version=2024-01-01",
    { method: "POST", headers: signedHeaders(action, body), body, signal },
    !action.startsWith("Get"),
  ).then((data) => data.Result as Record<string, unknown>);
}
export async function modelArk(
  endpoint: string,
  input?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  if (!env.BYTEPLUS_API_KEY)
    throw new AppError(503, "MODEL_SETUP", "Connect your ModelArk API key.");
  return providerRequest(
    env.BYTEPLUS_BASE_URL + endpoint,
    {
      method: input ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + env.BYTEPLUS_API_KEY,
      },
      body: input ? JSON.stringify(input) : undefined,
      signal,
    },
    !!input,
  );
}
async function providerRequest(
  url: string,
  init: RequestInit,
  mutation: boolean,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.any([
        AbortSignal.timeout(120000),
        ...(init.signal ? [init.signal] : []),
      ]),
      redirect: "error",
    });
  } catch {
    throw new ProviderError(
      mutation
        ? "The provider connection ended before confirmation. Review the provider task before retrying."
        : "The provider is temporarily unreachable.",
      mutation,
      !mutation,
    );
  }
  const data = await response.json().catch(() => null);
  const error = data?.ResponseMetadata?.Error ?? data?.error;
  if (!response.ok || error) {
    const code = String(error?.Code ?? error?.code ?? response.status);
    throw new ProviderError(
      "Provider rejected the request (" +
        code.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 100) +
        "). Check model access and input eligibility.",
      mutation && response.status >= 500,
      response.status === 429,
    );
  }
  if (!data || typeof data !== "object")
    throw new ProviderError(
      "The provider returned an invalid response.",
      mutation,
    );
  return data;
}
export function seedanceRequest(input: {
  videoUri: string;
  characterUrl: string;
  anchorUrl?: string;
  prompt: string;
  resolution: string;
}) {
  const content: Record<string, unknown>[] = [
    {
      type: "text",
      text:
        "Edit Video 1: replace the selected person with the character in Image 1. Preserve the source performance, camera movement, scene and timing. " +
        (input.anchorUrl
          ? "Use Image 2 as the opening appearance and composition reference. "
          : "") +
        input.prompt,
    },
    {
      type: "video_url",
      video_url: { url: input.videoUri },
      role: "reference_video",
    },
    {
      type: "image_url",
      image_url: { url: input.characterUrl },
      role: "reference_image",
    },
  ];
  if (input.anchorUrl)
    content.push({
      type: "image_url",
      image_url: { url: input.anchorUrl },
      role: "reference_image",
    });
  return {
    model: env.SEEDANCE_MODEL,
    content,
    omni_reference_task_type: "edit",
    ratio: "adaptive",
    duration: -1,
    resolution: input.resolution,
    generate_audio: true,
    watermark: true,
  };
}
export async function downloadProviderMedia(
  url: string,
  limit = 250 * 1024 * 1024,
) {
  const u = new URL(url);
  const allowed = [
    ".volces.com",
    ".bytepluses.com",
    ".bytepluscdn.com",
    ".byteplus.com",
    ".amazonaws.com",
    ".fal.media",
  ];
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    isIP(u.hostname) ||
    !(u.hostname === "fal.media" || allowed.some((s) => u.hostname.endsWith(s)))
  )
    throw new ProviderError("Provider returned an untrusted media host.");
  const addresses = await lookup(u.hostname, { all: true });
  if (
    addresses.some((a) =>
      /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|::1|fc|fd|fe80)/i.test(
        a.address,
      ),
    )
  )
    throw new ProviderError("Provider returned a private media address.");
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok || !response.body)
    throw new ProviderError("Could not download the generated media.");
  if (Number(response.headers.get("content-length") ?? 0) > limit)
    throw new ProviderError("Generated media exceeds the storage limit.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit)
      throw new ProviderError("Generated media exceeds the storage limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
