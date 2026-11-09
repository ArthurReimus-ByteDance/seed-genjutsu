import { workspace, workerSeenAt } from "@/server/workspace";
import { ok, route } from "@/server/http";
export const dynamic = "force-dynamic";
export const GET = (request: Request) =>
  route(async () => {
    try {
      await workspace.read((state) => state.version);
      const seen = await workerSeenAt();
      const ready = !new URL(request.url).searchParams.has("worker") || !!seen;
      return ok(
        {
          status: ready ? "ok" : "unavailable",
          mode: "local",
          persistence: "files",
          workerSeenAt: seen,
          ...(process.env.STUDIO_SMOKE_INSTANCE
            ? { smokeInstance: process.env.STUDIO_SMOKE_INSTANCE }
            : {}),
        },
        ready ? 200 : 503,
      );
    } catch {
      return ok({ status: "unavailable" }, 503);
    }
  }, request);
