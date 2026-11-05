import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
const { pool } = await import("../src/server/db");
const { readFile } = await import("node:fs/promises");
await pool.query(await readFile("db/001_initial.sql", "utf8"));
console.log("Database migrations applied.");
await pool.end();
