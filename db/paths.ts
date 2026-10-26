import path from "node:path";

/**
 * Absolute path to the SQLite file. Overridable with DATABASE_URL for tests or
 * alternate local setups; defaults to data/tedi.db under the project root.
 * The file is disposable: `npm run db:reset` deletes and reseeds it.
 */
export const DB_FILE =
  process.env.DATABASE_URL ?? path.join(process.cwd(), "data", "tedi.db");
