import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config.
 *
 * `DATABASE_URL` is used when it is present — that is what makes
 * `npx drizzle-kit push` work against a hosted Postgres (Neon / Supabase /
 * Vercel Postgres) exactly the same way it does against a local one. Drizzle Kit
 * loads `.env` automatically; in Vercel you only ever set the variable.
 *
 * The localhost fallback keeps a fresh clone working without any env file.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  },
  strict: false,
});
