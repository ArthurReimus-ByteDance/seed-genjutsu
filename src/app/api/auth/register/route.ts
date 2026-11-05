import { credentialsSchema } from "@/lib/schemas";
import { checkInvite, passwordHash, rateLimit, signIn } from "@/server/auth";
import { sql } from "@/server/db";
import { AppError, ok, readJson, route, sameOrigin } from "@/server/http";
export const POST = (request: Request) =>
  route(async () => {
    sameOrigin(request);
    const input = credentialsSchema.parse(await readJson(request));
    checkInvite(input.inviteCode);
    await rateLimit(
      "register:" + (request.headers.get("x-forwarded-for") ?? "local"),
      5,
      3600,
    );
    const encoded = await passwordHash(input.password);
    const rows = await sql(
      "INSERT INTO users (email,name,password_hash) VALUES ($1,$2,$3) ON CONFLICT (email) DO NOTHING RETURNING id,name,email",
      [input.email, input.name ?? input.email.split("@")[0], encoded],
    );
    if (!rows[0])
      throw new AppError(
        409,
        "ACCOUNT_EXISTS",
        "An account with this email already exists.",
      );
    await signIn(rows[0].id);
    return ok({ user: rows[0] }, 201);
  });
