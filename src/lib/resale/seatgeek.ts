// SeatGeek resale source
// Uses SeatGeek's public API (requires registration for a free client ID).
// Returns aggregate pricing stats if available.
// Falls back gracefully if SEATGEEK_CLIENT_ID is not configured.

import { Event } from "@/generated/prisma/client";
import {
  ResalePricing,
  ResaleSource,
  logSourceAttempt,
  getSourceDelay,
  sleep,
} from "@/lib/resale-sources";

const SEATGEEK_API_BASE = "https://api.seatgeek.com/2";
const SEATGEEK_CLIENT_ID = process.env.SEATGEEK_CLIENT_ID;
const USER_AGENT =
  process.env.SCRAPE_USER_AGENT || "ticket-flip-calendar/0.1 (personal project)";

/**
 * Query SeatGeek's /events API to find an event and extract its pricing stats.
 * Note: SeatGeek's /events endpoint gives aggregate stats, not detailed listings.
 */
async function fetchSeatGeekPricing(event: Event): Promise<ResalePricing | null> {
  if (!SEATGEEK_CLIENT_ID) {
    return null; // Silently disabled if no API key
  }

  const delay = getSourceDelay();
  await sleep(delay);

  try {
    // Query by event name to find the matching event
    const searchUrl = new URL(`${SEATGEEK_API_BASE}/events`);
    searchUrl.searchParams.append("client_id", SEATGEEK_CLIENT_ID);
    searchUrl.searchParams.append("q", event.name);
    searchUrl.searchParams.append("sort", "score.desc");

    const response = await fetch(searchUrl.toString(), {
      headers: {
        "User-Agent": USER_AGENT,
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const events = data.events || [];

    if (events.length === 0) {
      return null;
    }

    // Take the first matching event
    const firstEvent = events[0];
    const stats = firstEvent.stats;

    if (!stats) {
      return null;
    }

    // SeatGeek returns aggregate pricing stats
    return {
      priceMinUsd: stats.lowest_price ? Number(stats.lowest_price) : undefined,
      priceMaxUsd: stats.highest_price
        ? Number(stats.highest_price)
        : undefined,
      priceAvgUsd: stats.average_price
        ? Number(stats.average_price)
        : undefined,
      listingCount: stats.listing_count ? Number(stats.listing_count) : undefined,
    };
  } catch (error) {
    throw error; // Re-throw for caller to log
  }
}

export const seatgeekSource: ResaleSource = {
  name: "seatgeek",

  async fetchEventPricing(event: Event): Promise<ResalePricing | null> {
    try {
      if (!SEATGEEK_CLIENT_ID) {
        logSourceAttempt(
          this.name,
          event.name,
          event.ticketmasterId,
          "no-data",
          "SEATGEEK_CLIENT_ID not configured"
        );
        return null;
      }

      const pricing = await fetchSeatGeekPricing(event);

      if (!pricing) {
        logSourceAttempt(
          this.name,
          event.name,
          event.ticketmasterId,
          "no-data",
          "No pricing data from SeatGeek API"
        );
        return null;
      }

      logSourceAttempt(
        this.name,
        event.name,
        event.ticketmasterId,
        "ok",
        `min=$${pricing.priceMinUsd} max=$${pricing.priceMaxUsd} avg=$${pricing.priceAvgUsd}`
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
