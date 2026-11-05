import { currentUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { env } from "@/env";
export const GET = () =>
  route(async () =>
    ok({
      user: await currentUser(),
      registration: env.REGISTRATION_ENABLED === "true",
    }),
  );
