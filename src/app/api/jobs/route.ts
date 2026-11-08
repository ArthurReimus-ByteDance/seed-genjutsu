import { createJobSchema } from "@/lib/schemas";
import { createJob, listJobs } from "@/server/jobs";
import { ok, readJson, route } from "@/server/http";
export const dynamic = "force-dynamic";
export const GET = (request: Request) =>
  route(async () => ok({ jobs: await listJobs() }), request);
export const POST = (request: Request) =>
  route(async () => {
    const job = await createJob(createJobSchema.parse(await readJson(request)));
    const response = ok({ job }, 202);
    response.headers.set("Location", "/api/jobs/" + job.id);
    return response;
  }, request);
