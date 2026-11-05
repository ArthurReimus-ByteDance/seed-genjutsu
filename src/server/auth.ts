import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { hash, verify } from "@node-rs/argon2";
import { env } from "@/env";
import { sql } from "./db";
import { AppError } from "./http";
import type { User } from "@/lib/schemas";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function rateLimit(key: string, limit: number, seconds: number) {
  const bucket = Math.floor(Date.now() / (seconds * 1000));
  const rows = await sql(
    "INSERT INTO rate_limits (key,bucket,hits) VALUES ($1,$2,1) ON CONFLICT (key,bucket) DO UPDATE SET hits=rate_limits.hits+1 RETURNING hits",
    [digest(key), bucket],
  );
  if (rows[0].hits > limit)
    throw new AppError(
      429,
      "RATE_LIMIT",
      "Too many attempts. Please wait a little and try again.",
    );
}
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get("recast_session")?.value;
  if (!token) return null;
  const rows = await sql<User>(
    "SELECT u.id,u.email,u.name FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",
    [digest(token)],
  );
  return rows[0] ?? null;
}
export async function requireUser() {
  const user = await currentUser();
  if (!user)
    throw new AppError(401, "UNAUTHENTICATED", "Sign in to your workspace.");
  return user;
}
export async function signIn(userId: string) {
  if (!env.SESSION_SECRET)
    throw new AppError(
      503,
      "AUTH_SETUP",
      "Configure the session secret before signing in.",
    );
  const token = randomBytes(32).toString("base64url");
  await sql(
    "INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '7 days')",
    [digest(token), userId],
  );
  (await cookies()).set("recast_session", token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 604800,
    path: "/",
  });
}
export async function signOut() {
  const jar = await cookies();
  const token = jar.get("recast_session")?.value;
  if (token)
    await sql("DELETE FROM sessions WHERE token_hash=$1", [digest(token)]);
  jar.delete("recast_session");
}
export const passwordHash = (password: string) =>
  hash(password, { memoryCost: 65536, timeCost: 3, parallelism: 1 });
export const passwordMatches = (encoded: string, password: string) =>
  verify(encoded, password);
export function checkInvite(code?: string) {
  if (env.REGISTRATION_ENABLED !== "true")
    throw new AppError(
      403,
      "REGISTRATION_CLOSED",
      "New workspace registration is closed.",
    );
  if (env.INVITE_CODE) {
    const a = Buffer.from(digest(code ?? ""));
    const b = Buffer.from(digest(env.INVITE_CODE));
    if (!timingSafeEqual(a, b))
      throw new AppError(
        403,
        "INVITE_REQUIRED",
        "Enter a valid workspace invite code.",
      );
  }
}
