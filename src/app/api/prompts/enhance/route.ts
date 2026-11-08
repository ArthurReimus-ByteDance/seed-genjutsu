import { enhancePromptRequestSchema } from "@/lib/prompt-enhancement";
import { ok, readJson, route } from "@/server/http";
import { enhancePrompt } from "@/server/prompt-enhancement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = (request: Request) =>
  route(async () => {
    const input = enhancePromptRequestSchema.parse(await readJson(request));
    return ok({ enhancement: await enhancePrompt(input, request.signal) });
  }, request);
