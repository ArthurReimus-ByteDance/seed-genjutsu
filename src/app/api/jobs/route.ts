import { createJobSchema } from "@/lib/schemas";
import { requireUser, rateLimit } from "@/server/auth";
import { createJob, presentJob, type JobRow } from "@/server/jobs";
import { sql } from "@/server/db";
import { ok, readJson, route, sameOrigin } from "@/server/http";
export const GET = () =>
  route(async () => {
    const user = await requireUser();
    const rows = await sql<JobRow>(
      "SELECT * FROM jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50",
      [user.id],
    );
    return ok({ jobs: await Promise.all(rows.map(presentJob)) });
  });
export const POST = (request: Request) =>
  route(async () => {
    sameOrigin(request);
    const user = await requireUser();
    await rateLimit("create-job:" + user.id, 10, 300);
    return ok(
      {
        job: await createJob(
          user.id,
          createJobSchema.parse(await readJson(request)),
        ),
      },
      202,
    );
  });
