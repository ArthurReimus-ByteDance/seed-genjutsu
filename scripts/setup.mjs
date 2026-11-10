import { readFile, writeFile, access } from "node:fs/promises";
let existing;
for (const file of [
  ".env.local",
  ".env",
  ".env.development.local",
  ".env.development",
  ".env.production.local",
  ".env.production",
]) {
  try {
    await access(file);
    existing = file;
    break;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
if (existing) {
  console.log(existing + " already exists; left unchanged.");
} else {
  const text = (await readFile(".env.example", "utf8")).replace(
    "MEDIA_ROOT=.data",
    "MEDIA_ROOT=" + process.cwd() + "/.data",
  );
  await writeFile(".env.local", text, { mode: 0o600, flag: "wx" });
  console.log(
    "Created private .env.local for the local studio. No accounts or database required.",
  );
}
