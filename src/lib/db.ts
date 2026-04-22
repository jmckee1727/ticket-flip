// Prisma client singleton. Safe to import from anywhere.
// Uses the pg adapter — works locally against Supabase Postgres and in
// serverless runtime on Vercel.

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Add it to .env (local) or the Vercel project env."
  );
}

const makeClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
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
