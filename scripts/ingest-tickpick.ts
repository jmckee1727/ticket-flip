#!/usr/bin/env tsx
// TickPick historical resale price ingestion runner
// Usage: npm run ingest:tickpick [--artist NAME] [--limit N] [--dry-run] [--since DAYS]

import "dotenv/config";
import { prisma } from "@/lib/db";
import { findArtistSlug, fetchArtistPriceHistory, type PriceHistoryPoint } from "@/lib/tickpick";
import { z } from "zod";

// ============================================================================
// CLI Argument Parsing
// ============================================================================

interface CliOptions {
  artist?: string;
  limit: number;
  dryRun: boolean;
  since: number;
  mode: "future" | "past" | "all";
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    limit: 20,
    dryRun: false,
    since: 180,
    mode: "future",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--artist" && args[i + 1]) {
      options.artist = args[i + 1];
      i++;
    } else if (arg === "--limit" && args[i + 1]) {
      options.limit = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--since" && args[i + 1]) {
      options.since = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === "--past") {
      // Scrape TickPick for artists whose events are in the past N days.
      // Used for backfilling the historical corpus to calibrate projections.
      options.mode = "past";
    } else if (arg === "--all") {
      options.mode = "all";
    }
  }

  return options;
}

// ============================================================================
// Main Ingestion Logic
// ============================================================================

async function main() {
  const options = parseArgs();

  console.log("🎫 TickPick Historical Price Ingestion");
  console.log("========================================");
  console.log(
    `Options: limit=${options.limit}, dryRun=${options.dryRun}, since=${options.since} days${
      options.artist ? `, artist=${options.artist}` : ""
    }`
  );
  console.log();

  // Create ingestion run record
  const ingestionRun = await prisma.ingestionRun.create({
    data: {
      source: "tickpick",
    },
  });

  console.log(`Ingestion run ID: ${ingestionRun.id}`);
  console.log();

  let okCount = 0;
  let errCount = 0;
  let skipCount = 0;

  try {
    // Build the event date window depending on mode.
    const now = new Date();
    const sinceMs = options.since * 24 * 60 * 60 * 1000;
    let eventDateFilter: { gte?: Date; lte?: Date };
    if (options.mode === "past") {
      eventDateFilter = {
        gte: new Date(now.getTime() - sinceMs),
        lte: now,
      };
    } else if (options.mode === "all") {
      eventDateFilter = {
        gte: new Date(now.getTime() - sinceMs),
        lte: new Date(now.getTime() + sinceMs),
      };
    } else {
      // "future" — original behavior
      eventDateFilter = {
        gte: now,
        lte: new Date(now.getTime() + sinceMs),
      };
    }

    let artists = await prisma.artist.findMany({
      where: {
        events: { some: { eventDate: eventDateFilter } },
      },
      include: {
        events: {
          where: { eventDate: eventDateFilter },
          orderBy: { eventDate: "asc" },
        },
      },
      take: options.limit,
    });

    // If --artist is specified, filter to just that one
    if (options.artist) {
      artists = artists.filter((a) =>
        a.name.toLowerCase().includes(options.artist!.toLowerCase())
      );

      if (artists.length === 0) {
        console.log(`No artist found matching "${options.artist}". Available artists:`);
        const allArtists = await prisma.artist.findMany({
          take: 10,
          select: { name: true },
        });
        for (const a of allArtists) {
          console.log(`  - ${a.name}`);
        }
        process.exit(0);
      }
    }

    console.log(`Found ${artists.length} artist(s) with events in the next ${options.since} days`);

    for (const artist of artists) {
      console.log(`\n📍 Processing: ${artist.name}`);

      // Skip if no events
      if (!artist.events || artist.events.length === 0) {
        console.log(`  ⊘ No events found, skipping`);
        skipCount++;
        continue;
      }

      try {
        // Find TickPick slug
        console.log(`  → Looking up TickPick slug...`);
        const slug = await findArtistSlug(artist.name);

        if (!slug) {
          console.log(`  ⊘ No TickPick page found for "${artist.name}", skipping`);
          skipCount++;
          continue;
        }

        console.log(`  ✓ Found slug: ${slug}`);

        // Fetch price history
        console.log(`  → Fetching price history...`);
        const priceHistory = await fetchArtistPriceHistory(slug);

        if (priceHistory.length === 0) {
          console.log(`  ⊘ No price history data found on TickPick`);
          skipCount++;
          continue;
        }

        console.log(`  ✓ Got ${priceHistory.length} price points`);

        // For each event, find matching price snapshots by date proximity
        let eventCount = 0;
        for (const event of artist.events) {
          // Find price points within ±7 days of the event date
          const eventTime = event.eventDate.getTime();
          const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

          const matchingPoints = priceHistory.filter((p) => {
            const pointTime = p.date.getTime();
            return Math.abs(eventTime - pointTime) <= sevenDaysMs;
          });

          if (matchingPoints.length === 0) {
            continue;
          }

          // Write snapshots for this event
          for (const point of matchingPoints) {
            if (options.dryRun) {
              console.log(
                `    [DRY] Would create snapshot: ${event.name} on ${point.date.toISOString()} - $${point.priceAvgUsd}`
              );
              okCount++;
            } else {
              try {
                await prisma.resaleSnapshot.create({
                  data: {
                    eventId: event.id,
                    source: "tickpick",
                    capturedAt: point.date,
                    priceAvgUsd: point.priceAvgUsd,
                    priceMinUsd: point.priceMinUsd ?? undefined,
                    listingCount: point.listingCount ?? undefined,
                    daysUntilEvent: Math.floor(
                      (event.eventDate.getTime() - point.date.getTime()) / (24 * 60 * 60 * 1000)
                    ),
                  },
                });
                okCount++;
              } catch (err) {
                console.error(`    ✗ Error creating snapshot: ${err}`);
                errCount++;
              }
            }
          }

          eventCount++;
        }

        console.log(`  ✓ Processed ${eventCount} event(s)`);
      } catch (error) {
        // Check for Cloudflare block
        if ((error as any)?.message?.includes("Cloudflare")) {
          console.error(
            `\n⚠️  Cloudflare blocking detected. TickPick is blocking automated requests.`
          );
          console.error(
            `    Suggestion: Run the scraper from your own machine, or implement a different data strategy.`
          );

          await prisma.ingestionRun.update({
            where: { id: ingestionRun.id },
            data: {
              finishedAt: new Date(),
              okCount,
              errCount,
              notes: "Stopped: Cloudflare blocking detected. Try from your own machine.",
            },
          });

          process.exit(0);
        }

        console.error(`  ✗ Error: ${error}`);
        errCount++;
      }
    }

    console.log();
  } catch (error) {
    console.error("Fatal error:", error);
    await prisma.ingestionRun.update({
      where: { id: ingestionRun.id },
      data: {
        finishedAt: new Date(),
        errCount: 1,
        notes: `Fatal error: ${String(error)}`,
      },
    });
    process.exit(1);
  }

  // Close ingestion run
  await prisma.ingestionRun.update({
    where: { id: ingestionRun.id },
    data: {
      finishedAt: new Date(),
      okCount,
      errCount,
    },
  });

  // Summary
  console.log("========================================");
  if (options.dryRun) {
    console.log(`(dry-run mode; no data written)`);
  }
  console.log(`✓ Processed ${okCount} snapshot(s)`);
  if (skipCount > 0) {
    console.log(`⊘ Skipped ${skipCount} artist(s)`);
  }
  if (errCount > 0) {
    console.log(`✗ ${errCount} error(s)`);
  }
  console.log();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
