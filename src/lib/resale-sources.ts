// Resale pricing source abstraction
// Defines a common interface for fetching current resale pricing from multiple sources.
// Each source attempts to fetch data, returns null gracefully on failure, and logs clearly.

import { Event } from "@/generated/prisma/client";

// ============================================================================
// Common Types
// ============================================================================

export interface ResalePricing {
  priceMinUsd?: number;
  priceMedianUsd?: number;
  priceMaxUsd?: number;
  priceAvgUsd?: number;
  listingCount?: number;
  sectionsJson?: string;
}

export interface ResaleSource {
  name: string; // 'stubhub' | 'seatgeek' | 'tm_marketplace' | ...
  // Fetch current pricing stats for one event.
  // Returns null if unable to fetch (logs reason).
  // Never throws on a single-event failure.
  fetchEventPricing: (event: Event) => Promise<ResalePricing | null>;
}

// ============================================================================
// Logging Utilities
// ============================================================================

export function logSourceAttempt(
  source: string,
  eventName: string,
  ticketmasterId: string | null,
  status: "ok" | "no-data" | "blocked" | "error",
  details?: string
): void {
  const eventId = ticketmasterId ? `[${ticketmasterId}]` : "[?]";
  const msg = `[${source}] ${eventName} ${eventId} - ${status}${details ? `: ${details}` : ""}`;
  if (status === "error" || status === "blocked") {
    console.warn(msg);
  } else {
    console.log(msg);
  }
}

// ============================================================================
// Configuration / Utilities
// ============================================================================

export function getSourceDelay(): number {
  return parseInt(process.env.SCRAPE_REQUEST_DELAY_MS || "1500", 10);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
