// Run projections for upcoming events using a pluggable algorithm.
// Usage: npx tsx scripts/run-projections.ts [--algorithm NAME] [--event-id ID] [--upcoming-only] [--dry-run]

import "dotenv/config";
import { prisma } from "../src/lib/db";
import { getAlgorithm } from "../src/lib/projection";
import { findComparables } from "../src/lib/comparables";
import type { ProjectionInput } from "../src/lib/projection";

// ============================================================================
// Argument Parsing
// ============================================================================

interface RunOptions {
  algorithmName: string;
  eventId?: string;
  upcomingOnly: boolean;
  dryRun: boolean;
}

function parseArgs(): RunOptions {
  const args = process.argv.slice(2);
  const opts: RunOptions = {
    algorithmName: "placeholder_1_3x",
    upcomingOnly: true,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--algorithm" && i + 1 < args.length) {
      opts.algorithmName = args[++i];
    } else if (args[i] === "--event-id" && i + 1 < args.length) {
      opts.eventId = args[++i];
    } else if (args[i] === "--upcoming-only") {
      opts.upcomingOnly = true;
    } else if (args[i] === "--dry-run") {
      opts.dryRun = true;
    }
  }

  return opts;
}

// ============================================================================
// Main Runner
// ============================================================================

async function main() {
  const opts = parseArgs();

  console.log("\n🎯 Projection Runner");
  console.log("==================================================");
  console.log(`Algorithm: ${opts.algorithmName}`);
  console.log(`Upcoming only: ${opts.upcomingOnly}`);
  console.log(`Dry run: ${opts.dryRun}`);
  console.log("");

  // Load the algorithm
  const algo = getAlgorithm(opts.algorithmName);
  console.log(`✓ Loaded algorithm: ${algo.name} v${algo.version}`);

  // Fetch target events
  const now = new Date();

  let targetEvents: any[];

  if (opts.eventId) {
    targetEvents = await prisma.event.findMany({
      where: { id: opts.eventId },
      include: { artist: true, venue: true },
      orderBy: { eventDate: "asc" },
    });
  } else if (opts.upcomingOnly) {
    // Only events with onsaleStart >= now OR eventDate >= now
    targetEvents = await prisma.event.findMany({
      where: {
        OR: [
          { onsaleStart: { gte: now } },
          { eventDate: { gte: now } },
        ],
      },
      include: { artist: true, venue: true },
      orderBy: { eventDate: "asc" },
    });
  } else {
    targetEvents = await prisma.event.findMany({
      include: { artist: true, venue: true },
      orderBy: { eventDate: "asc" },
    });
  }

  console.log(`Found ${targetEvents.length} target event(s)\n`);

  if (targetEvents.length === 0) {
    console.log("No events to project.");
    await prisma.$disconnect();
    return;
  }

  // Run projections
  const results: Array<{
    eventId: string;
    eventName: string;
    projectedPriceUsd: number;
    projectedProfitUsd: number | null;
    confidence: number;
    comparablesCount: number;
  }> = [];

  const feeAssumptions = {
    sellerFeePct: 0.1, // 10% seller fee
    buyerFeePct: 0.1, // 10% buyer fee
  };

  for (const event of targetEvents) {
    try {
      // Find comparable events
      const comparables = await findComparables(event, prisma);

      // Fetch current snapshots for this event
      const ownSnapshots = await prisma.resaleSnapshot.findMany({
        where: { eventId: event.id },
        orderBy: { capturedAt: "asc" },
      });

      // Build input
      const input: ProjectionInput = {
        event,
        comparables,
        ownSnapshots,
        fees: feeAssumptions,
      };

      // Run algorithm
      const output = await algo.fn(input);

      // Log result
      console.log(`✓ ${event.name}`);
      console.log(`  Projected Price: $${output.projectedPriceUsd.toFixed(2)}`);
      console.log(
        `  Projected Profit: ${output.projectedProfitUsd ? "$" + output.projectedProfitUsd.toFixed(2) : "unknown (no face value)"}`
      );
      console.log(`  Confidence: ${(output.confidence * 100).toFixed(1)}%`);
      console.log(`  Comparables: ${output.reasoning.comparablesUsed.length}`);
      console.log(`  Summary: ${output.reasoning.summary}`);
      console.log("");

      results.push({
        eventId: event.id,
        eventName: event.name,
        projectedPriceUsd: output.projectedPriceUsd,
        projectedProfitUsd: output.projectedProfitUsd,
        confidence: output.confidence,
        comparablesCount: comparables.length,
      });

      // Insert projection into database (unless dry-run)
      if (!opts.dryRun) {
        await prisma.projection.create({
          data: {
            eventId: event.id,
            algorithmName: algo.name,
            algorithmVersion: algo.version,
            projectedPriceUsd: output.projectedPriceUsd,
            projectedProfitUsd: output.projectedProfitUsd,
            confidence: output.confidence,
            reasoningJson: JSON.stringify(output.reasoning),
          },
        });
      }
    } catch (err) {
      console.error(`✗ ${event.name}: ${err instanceof Error ? err.message : String(err)}`);
      console.log("");
    }
  }

  // Summary
  console.log("==================================================");
  console.log(`Ran ${results.length} projection(s) using ${algo.name} v${algo.version}`);

  if (results.length > 0) {
    const prices = results.map((r) => r.projectedPriceUsd);
    const profits = results
      .filter((r) => r.projectedProfitUsd !== null)
      .map((r) => r.projectedProfitUsd as number);

    const medianPrice = prices.length > 0 ? prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)] : 0;
    const medianProfit =
      profits.length > 0 ? profits.sort((a, b) => a - b)[Math.floor(profits.length / 2)] : null;

    const lowConfidenceCount = results.filter((r) => r.confidence < 0.3).length;

    console.log(`Median projected price: $${medianPrice.toFixed(2)}`);
    if (medianProfit !== null) {
      console.log(`Median projected profit: $${medianProfit.toFixed(2)}`);
    }
    console.log(`Low confidence (<30%): ${lowConfidenceCount}/${results.length}`);
  }

  console.log(`${opts.dryRun ? "[DRY RUN - no data written]" : "[Data persisted to database]"}`);
  console.log("");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
