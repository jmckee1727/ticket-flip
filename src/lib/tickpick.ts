// TickPick historical resale price scraper
// Fetches historical price data from TickPick's publicly available graphs
// TickPick has no public API, so we scrape the embedded JSON data from their pages.

import { z } from "zod";

// ============================================================================
// Types and Schemas
// ============================================================================

export interface PriceHistoryPoint {
  date: Date;
  priceAvgUsd: number;
  priceMinUsd?: number;
  listingCount?: number;
  eventName?: string;
}

export interface CurrentEventPricing {
  priceMedianUsd: number;
  priceMinUsd: number;
  priceMaxUsd: number;
  listingCount: number;
}

// Schema for parsing TickPick's embedded price data
const PricePointSchema = z.object({
  date: z.coerce.date(),
  priceAvg: z.number().optional(),
  priceMin: z.number().optional(),
  listingCount: z.number().optional(),
  eventName: z.string().optional(),
});

const PriceHistorySchema = z.array(PricePointSchema);

// ============================================================================
// Configuration
// ============================================================================

const TICKPICK_BASE_URL = "https://www.tickpick.com";
const REQUEST_DELAY_MS = parseInt(process.env.SCRAPE_REQUEST_DELAY_MS || "1500", 10);
const MAX_RETRIES = 3;
const USER_AGENT = process.env.SCRAPE_USER_AGENT || "ticket-flip-calendar/0.1 (personal project)";

// ============================================================================
// Utilities
// ============================================================================

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalize an artist name for slug matching.
 * Lowercase, remove special chars except hyphens, replace spaces with hyphens.
 */
function normalizeForSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[&!]/g, "and") // Replace & and ! with "and"
    .replace(/[^\w\s-]/g, "") // Remove special characters
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/-+/g, "-") // Collapse multiple hyphens
    .replace(/^-+|-+$/g, ""); // Trim hyphens
}

/**
 * Parse a URL-like value to a URL object safely.
 */
function safeParseUrl(urlString: string): URL | null {
  try {
    return new URL(urlString);
  } catch {
    return null;
  }
}

/**
 * Fetch with exponential backoff retry logic.
 * Detects and throws bot-detection blocks for special handling.
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = MAX_RETRIES
): Promise<Response> {
  const headers = {
    "User-Agent": USER_AGENT,
    ...options.headers,
  };

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, { ...options, headers });

      // Check for bot detection blocks first (before retrying)
      if (response.status === 403) {
        const text = await response.text();
        if (text.includes("Cloudflare") || text.includes("DataDome") || text.includes("challenge")) {
          const err = new Error(
            "Blocked by bot detection (Cloudflare/DataDome). TickPick is blocking automated requests."
          );
          (err as any).isCloudflareBlock = true;
          throw err;
        }
      }

      // 429 (Too Many Requests) or 5xx errors are retryable
      if (response.status === 429 || response.status >= 500) {
        if (attempt < retries - 1) {
          const delayMs = Math.pow(2, attempt) * REQUEST_DELAY_MS;
          await sleep(delayMs);
          continue;
        }
      }

      return response;
    } catch (error) {
      if ((error as any)?.isCloudflareBlock) {
        throw error;
      }

      if (attempt < retries - 1) {
        const delayMs = Math.pow(2, attempt) * REQUEST_DELAY_MS;
        await sleep(delayMs);
      } else {
        throw error;
      }
    }
  }

  throw new Error(`Failed to fetch ${url} after ${retries} retries`);
}

// ============================================================================
// Core Scraping Functions
// ============================================================================

/**
 * Find the TickPick slug for an artist by trying the direct slug and falling back to search.
 * Returns the slug if found, null otherwise.
 *
 * Note: TickPick may redirect based on category (e.g., /concert/eagles/ -> /nfl/philadelphia-eagles/).
 * We attempt to verify that the page loads successfully.
 */
export async function findArtistSlug(artistName: string): Promise<string | null> {
  if (!artistName || artistName.trim().length === 0) {
    return null;
  }

  const normalized = normalizeForSlug(artistName);

  // Try direct slug pattern first: https://www.tickpick.com/concert/{slug}-tickets/
  const directUrl = `${TICKPICK_BASE_URL}/concert/${normalized}-tickets/`;

  try {
    const response = await fetchWithRetry(directUrl, {}, 2);

    // Check for Cloudflare/DataDome blocking (403, 429, or error responses)
    if (response.status === 403) {
      const text = await response.text();
      if (text.includes("Cloudflare") || text.includes("DataDome") || text.includes("challenge")) {
        const err = new Error(
          "Blocked by Cloudflare/DataDome. Try from your own machine or consider a different scraping approach."
        );
        (err as any).isCloudflareBlock = true;
        throw err;
      }
    }

    // Also try to follow redirects in case TickPick redirects to a different category
    // (e.g., /concert/eagles/ -> /nfl/philadelphia-eagles/)
    if (response.status === 307 || response.status === 301) {
      const location = response.headers.get("location");
      if (location && !location.includes("/concert/")) {
        // It redirected to a different category (e.g., NFL), still consider it a valid slug
        return normalized;
      }
    }

    if (response.ok || response.status === 307 || response.status === 301) {
      return normalized;
    }

    // 404 or other errors: slug not found
    return null;
  } catch (error) {
    if ((error as any)?.isCloudflareBlock) {
      throw error;
    }
    return null;
  }
}

/**
 * Extract embedded JSON data from HTML script tags.
 * TickPick typically embeds price data in <script> tags as JSON.
 */
function extractJsonFromHtml(html: string): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];

  // Match script tags that might contain JSON
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = scriptRegex.exec(html)) !== null) {
    const content = match[1];

    // Look for patterns that suggest JSON data
    try {
      // Try to extract JSON objects/arrays from the script content
      const jsonRegex = /({.*?"price".*?}|\[.*?"price".*?\])/i;
      const jsonMatch = jsonRegex.exec(content);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        results.push(parsed);
      }
    } catch {
      // Ignore parse errors, continue searching
    }
  }

  // Also try to find window.__ or similar global data assignments
  const globalDataRegex = /window\.__(?:INITIAL_)?(?:STATE|DATA)__?\s*=\s*({[\s\S]*?})(?:;|<)/i;
  const globalMatch = globalDataRegex.exec(html);
  if (globalMatch) {
    try {
      const parsed = JSON.parse(globalMatch[1]);
      results.push(parsed);
    } catch {
      // Ignore parse errors
    }
  }

  return results;
}

/**
 * Parse price history data from the extracted JSON.
 * Expects data in format: { dates: [...], prices: [...], listings: [...] } or similar.
 */
function parsePriceHistory(data: unknown): PriceHistoryPoint[] {
  const points: PriceHistoryPoint[] = [];

  if (!data || typeof data !== "object") {
    return points;
  }

  const obj = data as Record<string, unknown>;

  // Check for common TickPick data structures
  // Pattern 1: { dates: [...], priceAvg: [...], priceMin: [...], listingCount: [...] }
  if (Array.isArray(obj.dates) && (Array.isArray(obj.priceAvg) || Array.isArray(obj.prices))) {
    const dates = obj.dates as unknown[];
    const priceAvgArr = (Array.isArray(obj.priceAvg) ? obj.priceAvg : obj.prices) as unknown[];
    const priceMinArr = Array.isArray(obj.priceMin) ? (obj.priceMin as unknown[]) : undefined;
    const listingArr = Array.isArray(obj.listingCount) ? (obj.listingCount as unknown[]) : undefined;

    for (let i = 0; i < dates.length; i++) {
      try {
        const date = new Date(dates[i] as string | number);
        const priceAvg = parseFloat(String(priceAvgArr[i]));

        if (isNaN(date.getTime()) || isNaN(priceAvg)) {
          continue;
        }

        const point: PriceHistoryPoint = {
          date,
          priceAvgUsd: priceAvg,
        };

        if (priceMinArr && i < priceMinArr.length) {
          const priceMin = parseFloat(String(priceMinArr[i]));
          if (!isNaN(priceMin)) {
            point.priceMinUsd = priceMin;
          }
        }

        if (listingArr && i < listingArr.length) {
          const listing = parseInt(String(listingArr[i]), 10);
          if (!isNaN(listing)) {
            point.listingCount = listing;
          }
        }

        points.push(point);
      } catch {
        // Skip invalid entries
      }
    }
  }

  // Pattern 2: Array of objects with date and price fields
  if (Array.isArray(data)) {
    const arr = data as unknown[];
    for (const item of arr) {
      if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        try {
          const dateValue = obj.date ?? obj.timestamp ?? obj.x;
          if (!dateValue) continue;

          const date = new Date(String(dateValue));
          const priceAvg =
            parseFloat(String(obj.priceAvg ?? obj.price ?? obj.y)) ||
            (obj.price ? parseFloat(String(obj.price)) : NaN);

          if (!isNaN(date.getTime()) && !isNaN(priceAvg)) {
            const point: PriceHistoryPoint = {
              date,
              priceAvgUsd: priceAvg,
            };

            if (obj.priceMin) {
              const min = parseFloat(String(obj.priceMin));
              if (!isNaN(min)) point.priceMinUsd = min;
            }

            if (obj.listingCount) {
              const count = parseInt(String(obj.listingCount), 10);
              if (!isNaN(count)) point.listingCount = count;
            }

            if (obj.eventName) {
              point.eventName = String(obj.eventName);
            }

            points.push(point);
          }
        } catch {
          // Skip invalid entries
        }
      }
    }
  }

  return points;
}

/**
 * Fetch the artist's TickPick page and extract historical price data.
 */
export async function fetchArtistPriceHistory(slug: string): Promise<PriceHistoryPoint[]> {
  if (!slug || slug.trim().length === 0) {
    return [];
  }

  const url = `${TICKPICK_BASE_URL}/concert/${slug}-tickets/`;

  try {
    const response = await fetchWithRetry(url);

    if (!response.ok) {
      if (response.status === 404) {
        return [];
      }
      throw new Error(`HTTP ${response.status} from ${url}`);
    }

    const html = await response.text();

    // Respect rate limiting
    await sleep(REQUEST_DELAY_MS);

    // Extract JSON blobs from the HTML
    const jsonData = extractJsonFromHtml(html);

    // Try to parse each JSON blob as price history
    for (const data of jsonData) {
      const points = parsePriceHistory(data);
      if (points.length > 0) {
        return points;
      }
    }

    // If no structured data found, return empty
    return [];
  } catch (error) {
    if ((error as any)?.isCloudflareBlock) {
      throw error;
    }

    // Log and return empty on other errors
    console.error(`Failed to fetch price history for ${slug}:`, error);
    return [];
  }
}

/**
 * Fetch current event pricing from a specific TickPick event URL.
 * This is a placeholder for potential future use; TickPick doesn't expose a per-event API.
 */
export async function fetchEventPricing(
  tickpickEventUrl: string
): Promise<CurrentEventPricing | null> {
  if (!tickpickEventUrl) {
    return null;
  }

  try {
    const response = await fetchWithRetry(tickpickEventUrl);

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    await sleep(REQUEST_DELAY_MS);

    // Try to extract pricing data from the page
    // This would require reverse-engineering the TickPick page structure
    // For now, return null as TickPick primarily exposes historical data
    return null;
  } catch (error) {
    if ((error as any)?.isCloudflareBlock) {
      throw error;
    }
    return null;
  }
}
