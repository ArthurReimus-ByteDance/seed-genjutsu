import { z } from "zod";
import { jobRecord, presentJob } from "@/server/jobs";
import { ok, route } from "@/server/http";
export const dynamic = "force-dynamic";
export const GET = (
  request: Request,
  context: { params: Promise<{ id: string }> },
) =>
  route(async () => {
    const { id } = await context.params;
    z.uuid().parse(id);
    return ok({ job: await presentJob(await jobRecord(id)) });
  }, request);
