// Ticketmaster Marketplace resale source
// Parses priceRanges from EventIngestSource.raw (already in our DB).
// This is our most reliable source since we already have the data locally.

import { Event, EventIngestSource } from "@/generated/prisma/client";
import { ResalePricing, ResaleSource, logSourceAttempt } from "@/lib/resale-sources";
import { prisma } from "@/lib/db";

/**
 * Parse Ticketmaster's raw event payload for resale price ranges.
 * Looks for priceRanges with type === 'resale' or similar.
 */
function parseResalePricesFromRaw(raw: unknown): ResalePricing | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const eventData = raw as any;
  const priceRanges = eventData.priceRanges;

  if (!Array.isArray(priceRanges) || priceRanges.length === 0) {
    return null;
  }

  // Filter for resale-type price ranges
  const resalePrices = priceRanges.filter(
    (pr: any) =>
      pr &&
      (pr.type === "resale" ||
        pr.type === "standard resale" ||
        (typeof pr.type === "string" && pr.type.toLowerCase().includes("resale")))
  );

  if (resalePrices.length === 0) {
    return null;
  }

  // Extract min/max from resale ranges
  const mins = resalePrices
    .map((pr: any) => pr.min)
    .filter((m: any) => typeof m === "number");
  const maxs = resalePrices
    .map((pr: any) => pr.max)
    .filter((m: any) => typeof m === "number");

  const priceMinUsd = mins.length > 0 ? Math.min(...mins) : undefined;
  const priceMaxUsd = maxs.length > 0 ? Math.max(...maxs) : undefined;

  // If we found at least one price point, return a pricing object
  if (priceMinUsd !== undefined || priceMaxUsd !== undefined) {
    return {
      priceMinUsd,
      priceMaxUsd,
    };
  }

  return null;
}

/**
 * Fetch resale pricing from Ticketmaster Marketplace by parsing the raw event data.
 */
export const tmMarketplaceSource: ResaleSource = {
  name: "tm_marketplace",

  async fetchEventPricing(event: Event): Promise<ResalePricing | null> {
    try {
      // Find the Ticketmaster ingest source row for this event
      const ingestSource = await prisma.eventIngestSource.findFirst({
        where: {
          eventId: event.id,
          source: "ticketmaster",
        },
      });

      if (!ingestSource) {
        logSourceAttempt(
          this.name,
          event.name,
          event.ticketmasterId,
          "no-data",
          "No TM ingest source found"
        );
        return null;
      }

      if (!ingestSource.raw) {
        logSourceAttempt(
          this.name,
          event.name,
          event.ticketmasterId,
          "no-data",
          "Raw TM payload is empty"
        );
        return null;
      }

      // Parse the raw JSON
      let rawData: unknown;
      try {
        rawData = JSON.parse(ingestSource.raw);
      } catch {
        logSourceAttempt(
          this.name,
          event.name,
          event.ticketmasterId,
          "error",
          "Failed to parse raw TM JSON"
        );
        return null;
      }

      // Extract resale prices
      const pricing = parseResalePricesFromRaw(rawData);

      if (!pricing) {
        logSourceAttempt(
          this.name,
          event.name,
          event.ticketmasterId,
          "no-data",
          "No resale price ranges found in TM data"
        );
        return null;
      }

      logSourceAttempt(
        this.name,
        event.name,
        event.ticketmasterId,
        "ok",
        `min=$${pricing.priceMinUsd} max=$${pricing.priceMaxUsd}`
      );

      return pricing;
    } catch (error) {
      logSourceAttempt(
        this.name,
        event.name,
        event.ticketmasterId,
        "error",
        (error instanceof Error ? error.message : String(error)).slice(0, 100)
      );
      return null;
    }
  },
};
