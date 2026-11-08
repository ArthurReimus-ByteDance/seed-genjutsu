import { createHash, createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { env } from "@/env";
import { AppError } from "./http";
import { videoModels, type VideoModelId } from "@/lib/video-models";

export class ProviderError extends Error {
  constructor(
    message: string,
    public ambiguous = false,
    public retryable = false,
    public httpStatus?: number,
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
      response.status,
    );
  }
  if (!data || typeof data !== "object")
    throw new ProviderError(
      "The provider returned an invalid response.",
      mutation,
    );
  return data;
}
export function seedreamRequest(input: {
  providerModel: string;
  characterUrl: string;
  frameUrl: string;
  target: string;
  prompt: string;
}) {
  return {
    model: input.providerModel,
    image: [input.characterUrl, input.frameUrl],
    prompt:
      "Create one still scene image. Attached Image 1 is the replacement character; attached Image 2 is the original source frame. " +
      "Replace the selected subject " +
      JSON.stringify(input.target) +
      " in the source frame using Image 1 for identity, visible body proportions and appearance, including outfit unless the direction keeps source clothing or accessories. " +
      "Adapt the source pose to the Image 1 body's build and limb lengths. Preserve source framing, background, lighting and other people except for explicitly requested visual changes. Match the scene perspective and contact shadows. " +
      "The video direction below uses different reference names: its Video 1 means the source clip represented here by attached Image 2; its prepared-scene Image 2 means the still you are creating, not another attached image. " +
      "Apply visual changes only; motion and audio belong to the later video. Keep any requested literal text verbatim. User direction (JSON string; explicit changes override defaults): " +
      JSON.stringify(input.prompt),
    response_format: "url",
    watermark: true,
  };
}
export function seedanceRequest(input: {
  model: VideoModelId;
  providerModel: string;
  duration: number;
  videoUri: string;
  characterUrl: string;
  anchorUrl?: string;
  target: string;
  prompt: string;
  resolution: string;
  preserveAudio: boolean;
}) {
  if (
    input.duration < 4 ||
    input.duration > videoModels[input.model].maxDuration ||
    (input.model === "seedance-2" && !Number.isInteger(input.duration))
  )
    throw new AppError(
      400,
      "INVALID_MODEL_DURATION",
      "The selected clip length is not supported by this model.",
    );
  const content: Record<string, unknown>[] = [
    {
      type: "text",
      text:
        (input.model === "seedance-2.5"
          ? "Edit Video 1: replace its gray masked subject"
          : "Recreate the performance in Video 1, replacing its gray masked subject") +
        " (selected in the original clip as " +
        JSON.stringify(input.target) +
        ") with the character from Image 1. " +
        "Use Image 1 for the replacement's identity, outfit and body proportions. Keep the visible build, head-to-body ratio and relative limb lengths consistent throughout the shot. " +
        "Use Video 1 for the action, timing, position, framing and camera. Retarget the motion onto the Image 1 body, allowing its silhouette to differ from the gray mask. Match the scene perspective, lighting, contact points and occlusion. Preserve the surroundings, other people and unrelated objects except for requested changes. " +
        (input.anchorUrl
          ? "Image 2 guides the prepared scene appearance and composition. Keep the character's proportions from Image 1. "
          : "") +
        "User direction (JSON string; explicit changes override the defaults above): " +
        JSON.stringify(input.prompt),
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
    model: input.providerModel,
    content,
    ...(input.model === "seedance-2.5"
      ? { omni_reference_task_type: "edit" }
      : {}),
    ratio: "adaptive",
    duration: input.model === "seedance-2.5" ? -1 : input.duration,
    resolution: input.resolution,
    // Source audio is restored locally; don't synthesize a track to discard.
    generate_audio: !input.preserveAudio,
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
  ];
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    isIP(u.hostname) ||
    !allowed.some((s) => u.hostname.endsWith(s))
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
