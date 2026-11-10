import type { QueryClient } from "@tanstack/react-query";
import type { studioQueryKeys } from "./api";
import type { Job } from "./schemas";

export async function reconcileJob(
  client: QueryClient,
  keys: ReturnType<typeof studioQueryKeys>,
  job: Job,
) {
  await Promise.all([
    client.cancelQueries({ queryKey: keys.job(job.id), exact: true }),
    client.cancelQueries({ queryKey: keys.jobs, exact: true }),
  ]);
  client.setQueryData<Job>(keys.job(job.id), (existing) =>
    existing && Date.parse(existing.updatedAt) > Date.parse(job.updatedAt)
      ? existing
      : job,
  );
  await Promise.all([
    client.invalidateQueries({ queryKey: keys.job(job.id), exact: true }),
    client.invalidateQueries({ queryKey: keys.jobs, exact: true }),
  ]);
}
