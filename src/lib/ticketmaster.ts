// Ticketmaster Discovery API v2 client
// Handles fetching US concerts and music festivals with built-in rate limiting and retry logic.

import { z } from "zod";

// ============================================================================
// Type and Schema Definitions
// ============================================================================

// Resellability flags derived from event payload scanning
export interface ResellabilityFlags {
  isSafeTix: boolean;
  isNonTransferable: boolean;
  resalePlatformRestriction: string | null;
  resalePriceCap: number | null;
}

// Extracted event data ready for database ingestion
export interface TicketmasterEvent {
  ticketmasterId: string;
  name: string;
  category: "CONCERT" | "FESTIVAL";
  eventDate: Date;
  onsaleStart: Date | null;
  onsaleEnd: Date | null;
  presaleStart: Date | null;
  presaleEnd: Date | null;
  faceMinUsd: number | null;
  faceMaxUsd: number | null;
  primaryUrl: string | null;
  venue: {
    ticketmasterId: string | null;
    name: string;
    city: string;
    state: string | null;
    country: string;
    postalCode: string | null;
    capacity: number | null;
  };
  artist: {
    ticketmasterId: string | null;
    name: string;
    genre: string | null;
  } | null;
  resellability: ResellabilityFlags;
  rawPayload: Record<string, unknown>;
}

// Zod schemas for API response validation
const DateTimeSchema = z.coerce.date().nullable().optional();

const ClassificationSchema = z
  .object({
    segment: z.object({ name: z.string() }).optional(),
    subType: z.object({ name: z.string() }).optional(),
    genre: z.object({ name: z.string() }).optional(),
  })
  .passthrough()
  .optional();

const PriceRangeSchema = z
  .object({
    type: z.string().optional(),
    currency: z.string().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .passthrough()
  .optional();

const PresaleSchema = z
  .object({
    startDateTime: z.coerce.date().optional(),
    endDateTime: z.coerce.date().optional(),
  })
  .passthrough()
  .optional();

const SalesSchema = z
  .object({
    public: z
      .object({
        startDateTime: z.coerce.date().optional(),
        endDateTime: z.coerce.date().optional(),
      })
      .passthrough()
      .optional(),
    presales: z.array(PresaleSchema).optional(),
  })
  .passthrough()
  .optional();

const TicketingSchema = z
  .object({
    safeTix: z
      .object({
        enabled: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
    transfer: z
      .object({
        enabled: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
  .optional();

const VenueSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    city: z
      .object({
        name: z.string().optional(),
      })
      .passthrough()
      .optional(),
    state: z
      .object({
        stateCode: z.string().optional(),
      })
      .passthrough()
      .optional(),
    country: z
      .object({
        countryCode: z.string().optional(),
      })
      .passthrough()
      .optional(),
    postalCode: z.string().optional(),
    generalInfo: z
      .object({
        capacity: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
  .optional();

const AttractionSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    classifications: z.array(ClassificationSchema).optional(),
  })
  .passthrough()
  .optional();

const EventSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    url: z.string().optional(),
    classifications: z.array(ClassificationSchema).optional(),
    dates: z
      .object({
        start: z
          .object({
            dateTime: z.coerce.date().optional(),
            localDate: z.coerce.date().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    sales: SalesSchema,
    priceRanges: z.array(PriceRangeSchema).optional(),
    ticketing: TicketingSchema,
    accessibility: z.object({}).passthrough().optional(),
    additionalInfo: z.object({}).passthrough().optional(),
    pleaseNote: z.string().optional(),
    generalInfo: z.object({}).passthrough().optional(),
    _embedded: z
      .object({
        venues: z.array(VenueSchema).optional(),
        attractions: z.array(AttractionSchema).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const PageSchema = z.object({
  number: z.number(),
  size: z.number(),
  totalElements: z.number(),
  totalPages: z.number(),
});

const DiscoveryApiResponseSchema = z
  .object({
    _embedded: z
      .object({
        events: z.array(EventSchema).optional(),
      })
      .optional(),
    page: PageSchema,
  })
  .passthrough();

type DiscoveryApiResponse = z.infer<typeof DiscoveryApiResponseSchema>;
type RawEvent = z.infer<typeof EventSchema>;

// ============================================================================
// Rate Limiting
// ============================================================================

class RateLimiter {
  private lastRequestTime: number = 0;
  private delayMs: number = 200; // ~5 req/sec for free tier

  async waitIfNeeded(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.delayMs) {
      const waitTime = this.delayMs - timeSinceLastRequest;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }
}

// ============================================================================
// Resellability Detection
// ============================================================================

function detectResellabilityFlags(event: RawEvent): ResellabilityFlags {
  const flags: ResellabilityFlags = {
    isSafeTix: false,
    isNonTransferable: false,
    resalePlatformRestriction: null,
    resalePriceCap: null,
  };

  // Collect all text fields to search for keywords
  const textFields = [
    event.ticketing?.safeTix?.enabled === true ? "SafeTix enabled" : "",
    event.pleaseNote || "",
    JSON.stringify(event.ticketing || ""),
    JSON.stringify(event.accessibility || ""),
    JSON.stringify(event.additionalInfo || ""),
    JSON.stringify(event.generalInfo || ""),
  ].join(" ");

  const lowerText = textFields.toLowerCase();

  // SafeTix detection
  if (
    event.ticketing?.safeTix?.enabled === true ||
    lowerText.includes("safetix") ||
    lowerText.includes("mobile entry") ||
    lowerText.includes("rotating barcode")
  ) {
    flags.isSafeTix = true;
  }

  // Non-transferable detection
  if (
    event.ticketing?.transfer?.enabled === false ||
    lowerText.includes("non-transferable") ||
    lowerText.includes("not transferable") ||
    lowerText.includes("no resale")
  ) {
    flags.isNonTransferable = true;
  }

  // Resale platform restriction detection
  if (
    lowerText.includes("resale only on ticketmaster") ||
    lowerText.includes("ticketmaster marketplace")
  ) {
    flags.resalePlatformRestriction = "TM_MARKETPLACE_ONLY";
  }

  // Resale price cap detection
  if (
    lowerText.includes("resale prices capped") ||
    lowerText.includes("up to face value") ||
    lowerText.includes("capped at face")
  ) {
    // Try to extract a dollar amount if present
    const dollarMatch = lowerText.match(/\$(\d+(?:\.\d{2})?)/);
    flags.resalePriceCap = dollarMatch
      ? parseFloat(dollarMatch[1])
      : event.priceRanges?.[0]?.max || null;
  }

  return flags;
}

// ============================================================================
// Event Parsing and Extraction
// ============================================================================

function extractEventData(raw: RawEvent): TicketmasterEvent | null {
  try {
    // Require essential fields
    if (!raw.id || !raw.name) {
      return null;
    }

    // Determine category (CONCERT or FESTIVAL)
    const classification = raw.classifications?.[0];
    const isFestival =
      classification?.subType?.name === "Festival" ||
      (Array.isArray(raw.classifications) &&
        raw.classifications.some((c) => c?.subType?.name === "Festival"));
    const category: "CONCERT" | "FESTIVAL" = isFestival
      ? "FESTIVAL"
      : "CONCERT";

    // Extract event date (prefer dateTime, fall back to localDate)
    let eventDate: Date | null = null;
    if (raw.dates?.start?.dateTime) {
      eventDate = new Date(raw.dates.start.dateTime);
    } else if (raw.dates?.start?.localDate) {
      eventDate = new Date(raw.dates.start.localDate);
    }

    if (!eventDate || isNaN(eventDate.getTime())) {
      return null;
    }

    // Extract on-sale window
    const onsaleStart = raw.sales?.public?.startDateTime
      ? new Date(raw.sales.public.startDateTime)
      : null;
    const onsaleEnd = raw.sales?.public?.endDateTime
      ? new Date(raw.sales.public.endDateTime)
      : null;

    // Extract presale window (earliest start, latest end)
    let presaleStart: Date | null = null;
    let presaleEnd: Date | null = null;

    if (raw.sales?.presales && raw.sales.presales.length > 0) {
      const presaleDates = raw.sales.presales
        .filter((p) => p?.startDateTime || p?.endDateTime)
        .map((p) => ({
          start: p?.startDateTime ? new Date(p.startDateTime) : null,
          end: p?.endDateTime ? new Date(p.endDateTime) : null,
        }));

      if (presaleDates.length > 0) {
        const validStarts = presaleDates
          .map((d) => d.start)
          .filter((d) => d && !isNaN(d.getTime())) as Date[];
        const validEnds = presaleDates
          .map((d) => d.end)
          .filter((d) => d && !isNaN(d.getTime())) as Date[];

        if (validStarts.length > 0) {
          presaleStart = new Date(Math.min(...validStarts.map((d) => d.getTime())));
        }
        if (validEnds.length > 0) {
          presaleEnd = new Date(Math.max(...validEnds.map((d) => d.getTime())));
        }
      }
    }

    // Extract price range
    const priceRange = raw.priceRanges?.[0];
    const faceMinUsd = priceRange?.min || null;
    const faceMaxUsd = priceRange?.max || null;

    // Extract venue (first in _embedded.venues)
    const rawVenue = raw._embedded?.venues?.[0];
    const venueName = rawVenue?.name || "Unknown Venue";
    const venueCity = rawVenue?.city?.name || "Unknown City";
    const venueState = rawVenue?.state?.stateCode || null;
    const venueCountry = rawVenue?.country?.countryCode || "US";
    const venuePostalCode = rawVenue?.postalCode || null;
    const venueCapacity = rawVenue?.generalInfo?.capacity || null;
    const venueTicketmasterId = rawVenue?.id || null;

    // Extract artist (first in _embedded.attractions)
    let artist: TicketmasterEvent["artist"] = null;
    const rawArtist = raw._embedded?.attractions?.[0];
    if (rawArtist?.name) {
      artist = {
        ticketmasterId: rawArtist.id || null,
        name: rawArtist.name,
        genre:
          rawArtist.classifications?.[0]?.genre?.name ||
          classification?.genre?.name ||
          null,
      };
    }

    // Detect resellability flags
    const resellability = detectResellabilityFlags(raw);

    return {
      ticketmasterId: raw.id,
      name: raw.name,
      category,
      eventDate,
      onsaleStart,
      onsaleEnd,
      presaleStart,
      presaleEnd,
      faceMinUsd,
      faceMaxUsd,
      primaryUrl: raw.url || null,
      venue: {
        ticketmasterId: venueTicketmasterId,
        name: venueName,
        city: venueCity,
        state: venueState,
        country: venueCountry,
        postalCode: venuePostalCode,
        capacity: venueCapacity,
      },
      artist,
      resellability,
      rawPayload: raw,
    };
  } catch (err) {
    console.error(`Failed to extract event data from ${raw.id}:`, err);
    return null;
  }
}

// ============================================================================
// API Client
// ============================================================================

export interface FetchUSConcertsOptions {
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}

const apiKey = process.env.TICKETMASTER_API_KEY;

export async function fetchUSConcerts(
  options: FetchUSConcertsOptions = {}
): Promise<TicketmasterEvent[]> {
  if (!apiKey) {
    throw new Error("TICKETMASTER_API_KEY is not set");
  }

  const limiter = new RateLimiter();
  const events: TicketmasterEvent[] = [];
  const startDate = options.startDate || new Date();
  const endDate = options.endDate || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const limit = options.limit;

  // Format dates for API (YYYY-MM-DD format)
  const formatDate = (d: Date): string => {
    return d.toISOString().split("T")[0];
  };

  const startDateStr = formatDate(startDate);
  const endDateStr = formatDate(endDate);

  let pageNum = 0;
  let hasMore = true;
  let maxRetries = 3;

  while (hasMore && (!limit || events.length < limit)) {
    try {
      await limiter.waitIfNeeded();

      const params = new URLSearchParams({
        apikey: apiKey,
        countryCode: "US",
        classificationName: "music",
        startDateTime: `${startDateStr}T00:00:00Z`,
        endDateTime: `${endDateStr}T23:59:59Z`,
        page: pageNum.toString(),
        size: "200",
      });

      const url = `https://app.ticketmaster.com/discovery/v2/events.json?${params}`;
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "ticket-flip-calendar/0.1 (discovery-api-client)",
        },
      });

      if (response.status === 429) {
        // Rate limited; back off
        console.warn("Rate limited (429), waiting 2 seconds before retry");
        await new Promise((resolve) => setTimeout(resolve, 2000));
        maxRetries--;
        if (maxRetries <= 0) {
          console.error("Rate limit max retries exceeded");
          break;
        }
        continue;
      }

      if (response.status >= 500) {
        // Server error; retry once
        console.warn(
          `Server error (${response.status}), waiting 2 seconds before retry`
        );
        await new Promise((resolve) => setTimeout(resolve, 2000));
        maxRetries--;
        if (maxRetries <= 0) {
          console.error("Server error max retries exceeded");
          break;
        }
        continue;
      }

      if (!response.ok) {
        console.error(
          `API error: ${response.status} ${response.statusText}`,
          await response.text()
        );
        break;
      }

      const data = await response.json();
      const validatedData = DiscoveryApiResponseSchema.parse(data);

      const pageEvents = validatedData._embedded?.events || [];
      for (const rawEvent of pageEvents) {
        if (limit && events.length >= limit) {
          break;
        }

        const extracted = extractEventData(rawEvent);
        if (extracted) {
          events.push(extracted);
        }
      }

      const page = validatedData.page;
      hasMore = page.number < page.totalPages - 1;
      pageNum++;

      // Reset retries on success
      maxRetries = 3;

      if (pageEvents.length === 0) {
        hasMore = false;
      }
    } catch (err) {
      console.error(`Error fetching page ${pageNum}:`, err);
      break;
    }
  }

  return events;
}
