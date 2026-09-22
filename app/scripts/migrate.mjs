// One-shot migration runner — applies every `.sql` file in src/db/migrations/, in filename order.
// Usage: node --env-file=.env.local scripts/migrate.mjs
import { neon } from "@neondatabase/serverless";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Missing DATABASE_URL — run with --env-file=.env.local");
const sql = neon(url);

const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
for (const file of files) {
  const raw = await readFile(path.join(dir, file), "utf8");
  const withoutComments = raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const statements = withoutComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  console.log(`Applying ${file} (${statements.length} statement(s))...`);
  for (const statement of statements) {
    await sql.query(statement);
  }
}
console.log(`Applied ${files.length} migration(s).`);
