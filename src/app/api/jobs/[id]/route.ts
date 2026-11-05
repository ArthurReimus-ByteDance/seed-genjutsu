import { z } from "zod";
import { requireUser } from "@/server/auth";
import { jobRow, presentJob } from "@/server/jobs";
import { ok, route } from "@/server/http";
export const GET = (
  _request: Request,
  context: { params: Promise<{ id: string }> },
) =>
  route(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    z.uuid().parse(id);
    return ok({ job: await presentJob(await jobRow(id, user.id)) });
  });
