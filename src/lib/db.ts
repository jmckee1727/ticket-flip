// Prisma client singleton. Safe to import from anywhere.
// Uses the better-sqlite3 adapter for local dev. Swap to @prisma/adapter-pg
// when migrating to Postgres in production.

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";

const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";

// Parse the SQLite URL. Accept forms like `file:./dev.db` or a raw path.
function resolveSqlitePath(url: string): string {
  if (url.startsWith("file:")) {
    return url.replace(/^file:/, "");
  }
  return url;
}

const makeClient = () =>
  new PrismaClient({
    adapter: new PrismaBetterSQLite3({ url: resolveSqlitePath(databaseUrl) }),
  });

// Cache on global in dev to survive Next.js hot-reload.
declare global {
  // eslint-disable-next-line no-var
  var __prisma: ReturnType<typeof makeClient> | undefined;
}

export const prisma = globalThis.__prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}
