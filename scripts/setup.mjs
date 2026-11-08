import { readFile, writeFile, access } from "node:fs/promises";
try {
  await access(".env.local");
  console.log(".env.local already exists; left unchanged.");
} catch {
  const text = (await readFile(".env.example", "utf8")).replace(
    "MEDIA_ROOT=.data",
    "MEDIA_ROOT=" + process.cwd() + "/.data",
  );
  await writeFile(".env.local", text, { mode: 0o600, flag: "wx" });
  console.log(
    "Created private .env.local for the local studio. No accounts or database required.",
  );
}
