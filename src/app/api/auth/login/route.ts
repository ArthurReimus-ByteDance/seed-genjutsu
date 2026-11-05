import { credentialsSchema } from "@/lib/schemas";
import {
  passwordHash,
  passwordMatches,
  rateLimit,
  signIn,
} from "@/server/auth";
import { sql } from "@/server/db";
import { AppError, ok, readJson, route, sameOrigin } from "@/server/http";
export const POST = (request: Request) =>
  route(async () => {
    sameOrigin(request);
    const input = credentialsSchema.parse(await readJson(request));
    await rateLimit("login:" + input.email, 8, 900);
    await rateLimit(
      "login-ip:" + (request.headers.get("x-forwarded-for") ?? "local"),
      40,
      900,
    );
    const rows = await sql(
      "SELECT id,name,email,password_hash FROM users WHERE email=$1",
      [input.email],
    );
    const row = rows[0];
    const valid = row
      ? await passwordMatches(row.password_hash, input.password)
      : await passwordHash(input.password).then(() => false);
    if (!valid)
      throw new AppError(
        401,
        "INVALID_CREDENTIALS",
        "Email or password is incorrect.",
      );
    await signIn(row.id);
    return ok({ user: { id: row.id, name: row.name, email: row.email } });
  });
