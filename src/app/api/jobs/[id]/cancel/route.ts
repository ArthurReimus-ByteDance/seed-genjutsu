import { z } from "zod";
import { cancelJob } from "@/server/jobs";
import { ok, route } from "@/server/http";
export const POST = (
  request: Request,
  context: { params: Promise<{ id: string }> },
) =>
  route(async () => {
    const { id } = await context.params;
    z.uuid().parse(id);
    return ok({ job: await cancelJob(id) });
  }, request);
