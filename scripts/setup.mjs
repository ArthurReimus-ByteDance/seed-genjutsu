import { randomBytes } from "node:crypto";
import { readFile, writeFile, access } from "node:fs/promises";
try {
  await access(".env.local");
  console.log(".env.local already exists; left unchanged.");
} catch {
  const password = randomBytes(24).toString("hex");
  const text = (await readFile(".env.example", "utf8"))
    .replaceAll("REPLACE_DB_PASSWORD", password)
    .replace("REPLACE_SESSION_SECRET", randomBytes(48).toString("base64url"))
    .replace("MEDIA_ROOT=.data", "MEDIA_ROOT=" + process.cwd() + "/.data");
  await writeFile(".env.local", text, { mode: 0o600, flag: "wx" });
  console.log(
    "Created private .env.local with random database and session secrets.",
  );
}
