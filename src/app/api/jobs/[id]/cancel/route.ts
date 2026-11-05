import { z } from "zod";
import { requireUser } from "@/server/auth";
import { sql } from "@/server/db";
import { event, jobRow, presentJob } from "@/server/jobs";
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
    const job = await jobRow(id, user.id);
    if (
      ["succeeded", "failed", "cancelled", "needs_attention"].includes(
        job.status,
      )
    )
      throw new AppError(
        409,
        "TERMINAL_JOB",
        "This generation has already finished.",
      );
    await sql(
      "UPDATE jobs SET cancel_requested=true,status=CASE WHEN status='awaiting_approval' OR status='queued' THEN 'cancelled' ELSE status END,updated_at=now() WHERE id=$1 AND user_id=$2",
      [id, user.id],
    );
    await event(
      id,
      "cancelled",
      "Cancellation requested. A generation already running at the provider may still finish.",
    );
    return ok({ job: await presentJob(await jobRow(id, user.id)) });
  });
