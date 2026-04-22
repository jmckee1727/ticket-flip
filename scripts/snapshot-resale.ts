#!/usr/bin/env tsx
// Current-price resale snapshotter
// Captures today's resale pricing for upcoming events across multiple sources.
// Usage: npm run snapshot [--source NAME] [--event-id ID] [--dry-run] [--upcoming-only]

import "dotenv/config";
import { prisma } from "@/lib/db";
import { tmMarketplaceSource } from "@/lib/resale/tm_marketplace";
import { stubhubSource } from "@/lib/resale/stubhub";
import { seatgeekSource } from "@/lib/resale/seatgeek";
import type { ResaleSource } from "@/lib/resale-sources";
import { differenceInDays } from "date-fns";

// ============================================================================
// CLI Argument Parsing
// ============================================================================

interface CliOptions {
  source?: string; // Run only this source (default: all)
  eventId?: string; // Snapshot only this event
  dryRun: boolean;
  upcomingOnly: boolean; // Default true: only events where eventDate >= now
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    dryRun: false,
    upcomingOnly: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--source" && args[i + 1]) {
      options.source = args[i + 1];
      i++;
    } else if (arg === "--event-id" && args[i + 1]) {
      options.eventId = args[i + 1];
      i++;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--upcoming-only") {
      options.upcomingOnly = true;
    }
  }

  return options;
}

// ============================================================================
// All Available Sources
// ============================================================================

const ALL_SOURCES: ResaleSource[] = [
  tmMarketplaceSource,
  stubhubSource,
  seatgeekSource,
];

// ============================================================================
// Event Filtering
// ============================================================================

async function getEventsToSnapshot(
  eventId?: string,
  upcomingOnly: boolean = true
): Promise<
  (ReturnType<typeof prisma.event.findFirst> extends Promise<infer T>
    ? T
    : never)[]
> {
  const now = new Date();

  const where: any = {};

  if (eventId) {
    where.id = eventId;
  } else if (upcomingOnly) {
    // Only events where eventDate >= now
    where.eventDate = {
      gte: now,
    };
    // Filter out events with invalid onsaleStart (placeholder 1900-01-01)
    where.onsaleStart = {
      gt: new Date("1900-02-01"), // Avoid placeholder
    };
  }

  const events = await prisma.event.findMany({
    where,
    take: 1000, // Reasonable limit
  });

  return events;
}

// ============================================================================
// Main Snapshotter
// ============================================================================

async function runSnapshot(options: CliOptions): Promise<void> {
  console.log("\n🎫 Resale Price Snapshotter");
  console.log("=====================================");
  console.log(
    `Options: source=${options.source || "all"}, eventId=${options.eventId || "any"}, dryRun=${options.dryRun}, upcomingOnly=${options.upcomingOnly}`
  );
  console.log("");

  // Fetch events to snapshot
  const events = await getEventsToSnapshot(options.eventId, options.upcomingOnly);
  console.log(`Found ${events.length} events to snapshot\n`);

  if (events.length === 0) {
    console.log("No events to snapshot.");
    process.exit(0);
  }

  // Determine which sources to run
  const sources = options.source
    ? ALL_SOURCES.filter((s) => s.name === options.source)
    : ALL_SOURCES;

  if (sources.length === 0) {
    console.error(`Source not found: ${options.source}`);
    process.exit(1);
  }

  // Track statistics per source
  const stats: Record<
    string,
    { ok: number; noData: number; blocked: number; error: number }
  > = {};
  sources.forEach((s) => {
    stats[s.name] = { ok: 0, noData: 0, blocked: 0, error: 0 };
  });

  // Open an IngestionRun per source (for tracking)
  const runIds: Record<string, string> = {};

  if (!options.dryRun) {
    for (const source of sources) {
      const run = await prisma.ingestionRun.create({
        data: {
          source: source.name,
          notes: `Resale snapshot run at ${new Date().toISOString()}`,
        },
      });
      runIds[source.name] = run.id;
    }
  }

  // Snapshot each event × each source
  for (const eventOrNull of events) {
    const event = eventOrNull;
    if (!event) continue;

    const daysUntilEvent = differenceInDays(event.eventDate, new Date());

    for (const source of sources) {
      try {
        const pricing = await source.fetchEventPricing(event);

        if (pricing) {
          // Success: got pricing data
          stats[source.name].ok++;

          if (!options.dryRun) {
            await prisma.resaleSnapshot.create({
              data: {
                eventId: event.id,
                source: source.name,
                capturedAt: new Date(),
                priceMinUsd: pricing.priceMinUsd,
                priceMedianUsd: pricing.priceMedianUsd,
                priceMaxUsd: pricing.priceMaxUsd,
                priceAvgUsd: pricing.priceAvgUsd,
                listingCount: pricing.listingCount,
                daysUntilEvent,
                sectionsJson: pricing.sectionsJson,
              },
            });
          }
        } else {
          // No data returned; assume "no-data" (could be no-data, blocked, or error)
          // The source logs the reason, so we just count it
          // We can't distinguish here, so we conservatively assume no-data
          stats[source.name].noData++;
        }
      } catch (error) {
        stats[source.name].error++;
        console.error(
          `Unexpected error for ${source.name} on ${event.name}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  // Update IngestionRun rows
  if (!options.dryRun) {
    for (const source of sources) {
      const s = stats[source.name];
      await prisma.ingestionRun.update({
        where: {
          id: runIds[source.name],
        },
        data: {
          okCount: s.ok,
          errCount: s.error,
          finishedAt: new Date(),
          notes: `ok=${s.ok}, noData=${s.noData}, blocked=${s.blocked}, error=${s.error}`,
        },
      });
    }
  }

  // Print summary
  console.log("\n=====================================");
  console.log("Summary per source:");
  console.log("");
  for (const source of sources) {
    const s = stats[source.name];
    const total = events.length;
    const pctOk = total > 0 ? Math.round((s.ok / total) * 100) : 0;
    const pctFail = total > 0 ? Math.round(((s.noData + s.blocked + s.error) / total) * 100) : 0;
    console.log(
      `  ${source.name}: ${s.ok}/${total} OK (${pctOk}%), ${s.noData} no-data, ${s.blocked} blocked, ${s.error} errors`
    );
  }
  console.log("");

  if (options.dryRun) {
    console.log("✓ Dry run complete (no data written to DB)");
  } else {
    console.log("✓ Snapshots written to ResaleSnapshot table");
  }
  console.log("");
}

// ============================================================================
// Entry Point
// ============================================================================

const options = parseArgs();
runSnapshot(options)
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
