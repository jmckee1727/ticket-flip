#!/usr/bin/env tsx
// Face-value refresh runner
//
// Ticketmaster's Discovery API only populates the `priceRanges` payload after
// an event's public on-sale window opens. Events ingested pre-onsale therefore
// arrive with null faceMinUsd/faceMaxUsd, and the homepage shows a dash. This
// script re-fetches each such event by its ticketmasterId and patches in the
// face values whenever the API has caught up.
//
// Usage:
//   npm run refresh:faces                   # default: onsale-started events with null face
//   npm run refresh:faces -- --dry-run      # preview the diff without writing
//   npm run refresh:faces -- --limit 100    # cap the batch
//   npm run refresh:faces -- --all          # include events regardless of onsale state

import "dotenv/config";
import { prisma } from "@/lib/db";
import { fetchEventById } from "@/lib/ticketmaster";

interface CliOptions {
  dryRun: boolean;
  limit: number;
  all: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = { dryRun: false, limit: 500, all: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--all") {
      opts.all = true;
    } else if (arg === "--limit" && args[i + 1]) {
      opts.limit = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return opts;
}

// Rate-limit ourselves to the Discovery API's ~5 req/sec free-tier ceiling.
async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const options = parseArgs();
  const now = new Date();

  console.log("💰 Ticketmaster Face-Value Refresh");
  console.log("========================================");
  console.log(
    `Options: dryRun=${options.dryRun}, limit=${options.limit}, all=${options.all}`
  );
  console.log();

  const run = await prisma.ingestionRun.create({
    data: { source: "ticketmaster-face-refresh" },
  });
  console.log(`Run ID: ${run.id}`);
  console.log();

  // Candidate set: events with a Ticketmaster ID and a null face price.
  // By default we only refresh events whose onsale window has already opened
  // — before that, re-fetching will just return null again.
  const candidates = await prisma.event.findMany({
    where: {
      ticketmasterId: { not: null },
      faceMinUsd: null,
      ...(options.all
        ? {}
        : {
            onsaleStart: { lte: now },
          }),
    },
    select: {
      id: true,
      ticketmasterId: true,
      name: true,
      onsaleStart: true,
      eventDate: true,
    },
    orderBy: { onsaleStart: "asc" },
    take: options.limit,
  });

  console.log(`Found ${candidates.length} event(s) with null face price\n`);

  let updated = 0;
  let stillNull = 0;
  let missing = 0;
  let errors = 0;

  for (const event of candidates) {
    if (!event.ticketmasterId) continue;

    try {
      const refreshed = await fetchEventById(event.ticketmasterId);

      if (!refreshed) {
        missing++;
        console.log(`  ✗ ${event.name}: not found (404 or delisted)`);
        await sleep(200);
        continue;
      }

      if (refreshed.faceMinUsd == null && refreshed.faceMaxUsd == null) {
        stillNull++;
        process.stdout.write(".");
        await sleep(200);
        continue;
      }

      if (options.dryRun) {
        console.log(
          `  [DRY] ${event.name}: $${refreshed.faceMinUsd ?? "?"} – $${
            refreshed.faceMaxUsd ?? "?"
          }`
        );
      } else {
        await prisma.event.update({
          where: { id: event.id },
          data: {
            faceMinUsd: refreshed.faceMinUsd,
            faceMaxUsd: refreshed.faceMaxUsd,
          },
        });
        console.log(
          `  ✓ ${event.name}: $${refreshed.faceMinUsd ?? "?"} – $${
            refreshed.faceMaxUsd ?? "?"
          }`
        );
      }
      updated++;
    } catch (err) {
      errors++;
      console.error(`  ✗ ${event.name}: ${err}`);
    }

    await sleep(200);
  }

  await prisma.ingestionRun.update({
    where: { id: run.id },
    data: {
      finishedAt: new Date(),
      okCount: updated,
      errCount: errors,
      notes: `stillNull=${stillNull}, missing=${missing}`,
    },
  });

  console.log("\n========================================");
  if (options.dryRun) console.log("(dry-run; no writes)");
  console.log(`✓ Updated:     ${updated}`);
  console.log(`⊘ Still null:  ${stillNull}  (API still hasn't populated)`);
  console.log(`⊘ Missing:     ${missing}    (404 or delisted)`);
  if (errors > 0) console.log(`✗ Errors:      ${errors}`);
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
