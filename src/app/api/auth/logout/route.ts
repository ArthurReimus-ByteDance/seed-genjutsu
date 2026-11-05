import { signOut } from "@/server/auth";
import { ok, route, sameOrigin } from "@/server/http";
export const POST = (request: Request) =>
  route(async () => {
    sameOrigin(request);
    await signOut();
    return ok({ success: true });
  });
