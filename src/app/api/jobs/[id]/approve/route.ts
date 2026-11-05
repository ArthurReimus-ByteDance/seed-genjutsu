import { z } from "zod";
import { requireUser } from "@/server/auth";
import { sql } from "@/server/db";
import { event, jobRow, presentJob, type JobRow } from "@/server/jobs";
import { AppError, ok, route, sameOrigin } from "@/server/http";
export const POST = (
  request: Request,
  context: { params: Promise<{ id: string }> },
) =>
  route(async () => {
    sameOrigin(request);
    const user = await requireUser();
    const { id } = await context.params;
    z.uuid().parse(id);
    await jobRow(id, user.id);
    const rows = await sql<JobRow>(
      "UPDATE jobs SET status='queued',stage='registering',next_run_at=now(),updated_at=now() WHERE id=$1 AND user_id=$2 AND status='awaiting_approval' AND masked_id IS NOT NULL AND (NOT (config->>'prepareImage')::boolean OR anchor_id IS NOT NULL) AND cancel_requested=false RETURNING *",
      [id, user.id],
    );
    if (!rows[0])
      throw new AppError(
        409,
        "NOT_AWAITING_APPROVAL",
        "This generation is not waiting for image approval.",
      );
    await event(
      id,
      "registering",
      "Prepared references approved. Continuing to video generation.",
    );
    return ok({ job: await presentJob(rows[0]) });
  });
