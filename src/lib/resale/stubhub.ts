// StubHub resale source
// Attempts to fetch pricing from StubHub's public listing pages.
// StubHub has aggressive anti-bot measures (Cloudflare, etc.).
// This is a scaffold; expects to be blocked by anti-bot systems in practice.

import { Event } from "@/generated/prisma/client";
import {
  ResalePricing,
  ResaleSource,
  logSourceAttempt,
  getSourceDelay,
  sleep,
} from "@/lib/resale-sources";

const MAX_RETRIES = 2;
const USER_AGENT =
  process.env.SCRAPE_USER_AGENT || "ticket-flip-calendar/0.1 (personal project)";

/**
 * Attempt to parse StubHub's event page for embedded pricing JSON.
 * StubHub renders price data client-side or behind bot protection,
 * so this will likely return null in practice.
 */
async function fetchStubHubPricing(event: Event): Promise<ResalePricing | null> {
  // Construct a possible StubHub URL based on event name
  // (This is speculative; StubHub's actual URL structure varies)
  const eventSlug = event.name
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);

  const stubhubUrl = `https://www.stubhub.com/${eventSlug}`;

  const delay = getSourceDelay();

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Wait before request to avoid rate limiting
      if (attempt > 0) {
        await sleep(delay * (attempt + 1));
      }

      const response = await fetch(stubhubUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
        },
      });

      // Check for bot detection
      if (response.status === 403) {
        const text = await response.text();
        if (
          text.includes("Cloudflare") ||
          text.includes("challenge") ||
          text.includes("robot")
        ) {
          return null; // Blocked by bot detection, don't retry
        }
      }

      if (!response.ok) {
        if (response.status === 429 && attempt < MAX_RETRIES - 1) {
          // Rate limited, retry
          continue;
        }
        return null;
      }

      // StubHub renders price data client-side, which our server-side fetch cannot access.
      // Would need a headless browser like Puppeteer to parse the DOM.
      // For now, return null as this is expected to be blocked.
      return null;
    } catch (error) {
      if (attempt === MAX_RETRIES - 1) {
        throw error;
      }
      await sleep(delay * (attempt + 1));
    }
  }

  return null;
}

export const stubhubSource: ResaleSource = {
  name: "stubhub",

  async fetchEventPricing(event: Event): Promise<ResalePricing | null> {
    try {
      const pricing = await fetchStubHubPricing(event);

      if (!pricing) {
        logSourceAttempt(
          this.name,
          event.name,
          event.ticketmasterId,
          "blocked",
          "Unable to fetch or parse StubHub data (likely bot-blocked)"
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
        "blocked",
        (error instanceof Error ? error.message : String(error)).slice(0, 100)
      );
      return null;
    }
  },
};
