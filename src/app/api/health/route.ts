import { workspace } from "@/server/workspace";
import { ok, route } from "@/server/http";
export const dynamic = "force-dynamic";
export const GET = (request: Request) =>
  route(async () => {
    try {
      await workspace.read((state) => state.version);
      return ok({ status: "ok", mode: "local", persistence: "files" });
    } catch {
      return ok({ status: "unavailable" }, 503);
    }
  }, request);
