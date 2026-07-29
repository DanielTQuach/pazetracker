import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, isPostgresEnabled } from "../db/client.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function loadEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile();

if (!isPostgresEnabled()) {
  console.error("Set DATABASE_URL before running migrations.");
  process.exit(1);
}

const schemaPath = path.join(ROOT, "db", "schema.sql");
const sql = fs.readFileSync(schemaPath, "utf8");
const pool = getPool();

try {
  await pool.query(sql);
  console.log("Migration applied:", schemaPath);
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
