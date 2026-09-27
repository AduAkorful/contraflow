// One-shot migration runner — applies every `.sql` file in src/db/migrations/, in filename order,
// or only files starting with the given prefix. Every migration is written to be re-runnable.
// Usage: node --env-file=.env.local scripts/migrate.mjs [prefix]
import { neon } from "@neondatabase/serverless";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Missing DATABASE_URL — run with --env-file=.env.local");
const sql = neon(url);

const only = process.argv[2];
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql") && (!only || f.startsWith(only))).sort();

/// Splits on `;` outside `$$ ... $$` bodies, so a plpgsql function stays one statement.
function splitStatements(text) {
  const parts = text.split("$$");
  const statements = [];
  let current = "";
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      current += `$$${part}$$`;
      return;
    }
    const pieces = part.split(";");
    current += pieces[0];
    for (const piece of pieces.slice(1)) {
      statements.push(current);
      current = piece;
    }
  });
  statements.push(current);
  return statements.map((s) => s.trim()).filter((s) => s.length > 0);
}
for (const file of files) {
  const raw = await readFile(path.join(dir, file), "utf8");
  const withoutComments = raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const statements = splitStatements(withoutComments);
  console.log(`Applying ${file} (${statements.length} statement(s))...`);
  for (const statement of statements) {
    await sql.query(statement);
  }
}
console.log(`Applied ${files.length} migration(s).`);
