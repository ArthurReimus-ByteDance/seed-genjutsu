import { sql } from "@/server/db";
import { ok } from "@/server/http";
export async function GET() {
  try {
    await sql("SELECT 1");
    return ok({ status: "ok" });
  } catch {
    return ok({ status: "unavailable" }, 503);
  }
}
