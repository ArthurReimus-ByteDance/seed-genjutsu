import { createFalClient } from "@fal-ai/client";
import { env } from "@/env";
import { AppError } from "./http";
import { ProviderError } from "./providers";
export function falClient() {
  if (!env.FAL_KEY)
    throw new AppError(
      503,
      "FAL_SETUP",
      "Connect your fal.ai API key and SAM endpoint to prepare the masked video.",
    );
  return createFalClient({ credentials: env.FAL_KEY });
}
export async function submitSam(
  videoUrl: string,
  target: string,
  signal?: AbortSignal,
) {
  if (!env.FAL_KEY)
    throw new AppError(503, "FAL_SETUP", "Connect your fal.ai API key.");
  // The SDK retries queue submissions automatically. Submit exactly once so an
  // interrupted response cannot silently create several billable requests.
  let response: Response;
  try {
    response = await fetch("https://queue.fal.run/" + env.FAL_SAM_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: "Key " + env.FAL_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        video_url: videoUrl,
        prompt: target,
        apply_mask: true,
        video_output_type: "X264 (.mp4)",
        detection_threshold: 0.5,
        max_num_objects: 1,
      }),
      signal: AbortSignal.any([
        AbortSignal.timeout(120000),
        ...(signal ? [signal] : []),
      ]),
      redirect: "error",
    });
  } catch {
    throw new ProviderError(
      "The SAM submission was not confirmed. Check fal.ai before retrying.",
      true,
    );
  }
  if (!response.ok)
    throw new ProviderError(
      "fal.ai rejected the SAM request (" +
        response.status +
        "). Check endpoint access and input eligibility.",
      response.status >= 500,
    );
  const result = await response.json().catch(() => null);
  if (typeof result?.request_id !== "string" || !result.request_id)
    throw new ProviderError(
      "fal.ai returned no request ID. Check its queue before retrying.",
      true,
    );
  return { request_id: result.request_id as string };
}
export async function samStatus(requestId: string) {
  return falClient().queue.status(env.FAL_SAM_ENDPOINT, {
    requestId,
    logs: false,
  });
}
export async function samResult(requestId: string) {
  const result = await falClient().queue.result(env.FAL_SAM_ENDPOINT, {
    requestId,
  });
  const value = result.data as { video?: { url?: string } | string };
  const url = typeof value.video === "string" ? value.video : value.video?.url;
  if (!url)
    throw new ProviderError(
      "The SAM endpoint did not return a masked video. Check the endpoint output schema.",
    );
  return url;
}
