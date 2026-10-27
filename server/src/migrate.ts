import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const { pool } = await import("./models/db.ts");

// Migrations are plain SQL files applied in filename order.
//
// Each file runs inside its own transaction together with the row that records it, so a
// migration either applies completely and is marked applied, or does neither. There is no
// state where the schema has half a migration in it and nothing says so.
//
// Applied files are never edited. A change to the schema is a new file.

const migrationsDirectory = path.join(import.meta.dirname, "..", "migrations");

const applyMigrations = async () => {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT        PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const recorded = await client.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations"
    );
    const alreadyApplied = new Set(recorded.rows.map((row) => row.filename));

    const filenames = readdirSync(migrationsDirectory)
      .filter((filename) => filename.endsWith(".sql"))
      .sort();

    let appliedCount = 0;

    for (const filename of filenames) {
      if (alreadyApplied.has(filename)) {
        console.log(`skip     ${filename}`);
        continue;
      }

      const sql = readFileSync(path.join(migrationsDirectory, filename), "utf8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Migration ${filename} failed and was rolled back: ${detail}`);
      }

      console.log(`applied  ${filename}`);
      appliedCount += 1;
    }

    console.log(appliedCount === 0 ? "Schema already up to date." : `Applied ${appliedCount} migration(s).`);
  } finally {
    client.release();
    await pool.end();
  }
};

applyMigrations().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
