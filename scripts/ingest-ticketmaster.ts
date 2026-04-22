#!/usr/bin/env tsx
// Ticketmaster Discovery API ingestion runner
// Usage: npm run ingest:ticketmaster [--days N] [--dry-run] [--use-fixture] [--limit N]

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { prisma } from "@/lib/db";
import { fetchUSConcerts, type TicketmasterEvent } from "@/lib/ticketmaster";
import { z } from "zod";

// ============================================================================
// CLI Argument Parsing
// ============================================================================

interface CliOptions {
  days: number;
  dryRun: boolean;
  useFixture: boolean;
  limit?: number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    days: 90,
    dryRun: false,
    useFixture: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--days" && args[i + 1]) {
      options.days = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--use-fixture") {
      options.useFixture = true;
    } else if (arg === "--limit" && args[i + 1]) {
      options.limit = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return options;
}

// ============================================================================
// Minimal Event Extraction from Raw Ticketmaster Payload
// ============================================================================

function extractEventFromRaw(raw: any): TicketmasterEvent | null {
  try {
    if (!raw.id || !raw.name) {
      return null;
    }

    // Category detection
    const isFestival =
      raw.classifications?.some(
        (c: any) => c?.subType?.name === "Festival"
      ) ?? false;
    const category = isFestival ? "FESTIVAL" : "CONCERT";

    // Event date
    let eventDate: Date | null = null;
    if (raw.dates?.start?.dateTime) {
      eventDate = new Date(raw.dates.start.dateTime);
    } else if (raw.dates?.start?.localDate) {
      eventDate = new Date(raw.dates.start.localDate);
    }

    if (!eventDate || isNaN(eventDate.getTime())) {
      return null;
    }

    // On-sale window
    const onsaleStart = raw.sales?.public?.startDateTime
      ? new Date(raw.sales.public.startDateTime)
      : null;
    const onsaleEnd = raw.sales?.public?.endDateTime
      ? new Date(raw.sales.public.endDateTime)
      : null;

    // Presale window
    let presaleStart: Date | null = null;
    let presaleEnd: Date | null = null;

    if (raw.sales?.presales && Array.isArray(raw.sales.presales)) {
      const validPresales = raw.sales.presales.filter(
        (p: any) => p?.startDateTime || p?.endDateTime
      );

      if (validPresales.length > 0) {
        const starts = validPresales
          .map((p: any) => (p?.startDateTime ? new Date(p.startDateTime) : null))
          .filter((d: Date | null) => d && !isNaN(d.getTime()));

        const ends = validPresales
          .map((p: any) => (p?.endDateTime ? new Date(p.endDateTime) : null))
          .filter((d: Date | null) => d && !isNaN(d.getTime()));

        if (starts.length > 0) {
          presaleStart = new Date(Math.min(...starts.map((d: Date) => d.getTime())));
        }
        if (ends.length > 0) {
          presaleEnd = new Date(Math.max(...ends.map((d: Date) => d.getTime())));
        }
      }
    }

    // Price range
    const priceRange = raw.priceRanges?.[0];
    const faceMinUsd = priceRange?.min ?? null;
    const faceMaxUsd = priceRange?.max ?? null;

    // Venue
    const rawVenue = raw._embedded?.venues?.[0];
    const venueName = rawVenue?.name || "Unknown Venue";
    const venueCity = rawVenue?.city?.name || "Unknown City";
    const venueState = rawVenue?.state?.stateCode ?? null;
    const venueCountry = rawVenue?.country?.countryCode || "US";
    const venuePostalCode = rawVenue?.postalCode ?? null;
    const venueCapacity = rawVenue?.generalInfo?.capacity ?? null;
    const venueTicketmasterId = rawVenue?.id ?? null;

    // Artist
    const rawArtist = raw._embedded?.attractions?.[0];
    let artist: TicketmasterEvent["artist"] = null;
    if (rawArtist?.name) {
      artist = {
        ticketmasterId: rawArtist.id ?? null,
        name: rawArtist.name,
        genre: rawArtist.classifications?.[0]?.genre?.name ?? null,
      };
    }

    // Resellability flags
    const textContent = [
      raw.pleaseNote || "",
      JSON.stringify(raw.ticketing || ""),
      JSON.stringify(raw.accessibility || ""),
      JSON.stringify(raw.additionalInfo || ""),
    ]
      .join(" ")
      .toLowerCase();

    const isSafeTix =
      raw.ticketing?.safeTix?.enabled === true ||
      textContent.includes("safetix") ||
      textContent.includes("mobile entry") ||
      textContent.includes("rotating barcode");

    const isNonTransferable =
      raw.ticketing?.transfer?.enabled === false ||
      textContent.includes("non-transferable") ||
      textContent.includes("not transferable") ||
      textContent.includes("no resale");

    const resalePlatformRestriction =
      textContent.includes("resale only on ticketmaster") ||
      textContent.includes("ticketmaster marketplace")
        ? "TM_MARKETPLACE_ONLY"
        : null;

    let resalePriceCap: number | null = null;
    if (
      textContent.includes("resale prices capped") ||
      textContent.includes("up to face value") ||
      textContent.includes("capped at face")
    ) {
      const dollarMatch = textContent.match(/\$(\d+(?:\.\d{2})?)/);
      resalePriceCap = dollarMatch
        ? parseFloat(dollarMatch[1])
        : faceMaxUsd;
    }

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
      primaryUrl: raw.url ?? null,
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
      resellability: {
        isSafeTix,
        isNonTransferable,
        resalePlatformRestriction,
        resalePriceCap,
      },
      rawPayload: raw,
    };
  } catch (err) {
    console.error(`Failed to extract event from ${raw.id}:`, err);
    return null;
  }
}

// ============================================================================
// Fixture Loading
// ============================================================================

function loadFixture(limit?: number): TicketmasterEvent[] {
  const fixtureDir = path.join(process.cwd(), "fixtures");
  const fixturePath = path.join(fixtureDir, "ticketmaster-sample.json");

  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Fixture not found at ${fixturePath}`);
  }

  const rawData = fs.readFileSync(fixturePath, "utf-8");
  const parsed = JSON.parse(rawData);

  if (!parsed._embedded || !parsed._embedded.events) {
    throw new Error("Invalid fixture format: missing _embedded.events");
  }

  let events = parsed._embedded.events
    .map((raw: any) => extractEventFromRaw(raw))
    .filter((e: TicketmasterEvent | null) => e !== null);

  if (limit) {
    events = events.slice(0, limit);
  }

  return events;
}

// ============================================================================
// Database Operations
// ============================================================================

async function upsertArtist(
  event: TicketmasterEvent
): Promise<string | null> {
  if (!event.artist) {
    return null;
  }

  const existing = await prisma.artist.findFirst({
    where: {
      OR: [
        { name: event.artist.name },
        ...(event.artist.ticketmasterId
          ? [{ ticketmasterId: event.artist.ticketmasterId }]
          : []),
      ],
    },
  });

  if (existing) {
    return existing.id;
  }

  const created = await prisma.artist.create({
    data: {
      name: event.artist.name,
      ticketmasterId: event.artist.ticketmasterId || undefined,
      genres: event.artist.genre ? event.artist.genre : undefined,
    },
  });

  return created.id;
}

async function upsertVenue(event: TicketmasterEvent): Promise<string> {
  const { venue } = event;

  // Try to find by ticketmasterId first
  if (venue.ticketmasterId) {
    const existing = await prisma.venue.findUnique({
      where: { ticketmasterId: venue.ticketmasterId },
    });
    if (existing) {
      return existing.id;
    }
  }

  // Try to find by composite unique (name, city, state) only if state is available
  // (the composite unique constraint requires all fields to be non-null)
  if (venue.state) {
    const existing = await prisma.venue.findUnique({
      where: {
        name_city_state: {
          name: venue.name,
          city: venue.city,
          state: venue.state,
        },
      },
    });

    if (existing) {
      return existing.id;
    }
  }

  const created = await prisma.venue.create({
    data: {
      name: venue.name,
      city: venue.city,
      state: venue.state || undefined,
      country: venue.country,
      postalCode: venue.postalCode || undefined,
      capacity: venue.capacity || undefined,
      ticketmasterId: venue.ticketmasterId || undefined,
    },
  });

  return created.id;
}

async function upsertEvent(
  event: TicketmasterEvent,
  venueId: string,
  artistId: string | null
): Promise<string> {
  const existing = await prisma.event.findUnique({
    where: { ticketmasterId: event.ticketmasterId },
  });

  const eventData = {
    ticketmasterId: event.ticketmasterId,
    name: event.name,
    category: event.category,
    eventDate: event.eventDate,
    onsaleStart: event.onsaleStart || undefined,
    onsaleEnd: event.onsaleEnd || undefined,
    presaleStart: event.presaleStart || undefined,
    presaleEnd: event.presaleEnd || undefined,
    faceMinUsd: event.faceMinUsd || undefined,
    faceMaxUsd: event.faceMaxUsd || undefined,
    primaryUrl: event.primaryUrl || undefined,
    isSafeTix: event.resellability.isSafeTix,
    isNonTransferable: event.resellability.isNonTransferable,
    resalePlatformRestriction:
      event.resellability.resalePlatformRestriction || undefined,
    resalePriceCap: event.resellability.resalePriceCap || undefined,
    venueId,
    artistId: artistId || undefined,
  };

  if (existing) {
    return await prisma.event
      .update({
        where: { ticketmasterId: event.ticketmasterId },
        data: eventData,
      })
      .then((e) => e.id);
  }

  return await prisma.event
    .create({ data: eventData })
    .then((e) => e.id);
}

async function upsertIngestSource(
  event: TicketmasterEvent,
  eventId: string
): Promise<void> {
  const existing = await prisma.eventIngestSource.findUnique({
    where: {
      source_externalId: {
        source: "ticketmaster",
        externalId: event.ticketmasterId,
      },
    },
  });

  if (existing) {
    return;
  }

  await prisma.eventIngestSource.create({
    data: {
      eventId,
      source: "ticketmaster",
      externalId: event.ticketmasterId,
      raw: JSON.stringify(event.rawPayload),
      fetchedAt: new Date(),
    },
  });
}

// ============================================================================
// Main Ingestion Logic
// ============================================================================

async function main() {
  const options = parseArgs();

  console.log("🎫 Ticketmaster Discovery API Ingestion");
  console.log("========================================");
  console.log(
    `Options: days=${options.days}, dryRun=${options.dryRun}, useFixture=${options.useFixture}${
      options.limit ? `, limit=${options.limit}` : ""
    }`
  );
  console.log();

  // Create ingestion run record
  const ingestionRun = await prisma.ingestionRun.create({
    data: {
      source: "ticketmaster",
    },
  });

  console.log(`Ingestion run ID: ${ingestionRun.id}`);

  let events: TicketmasterEvent[] = [];
  try {
    if (options.useFixture) {
      console.log("Loading events from fixture...");
      events = loadFixture(options.limit);
    } else {
      console.log(
        `Fetching events for next ${options.days} days from Ticketmaster Discovery API...`
      );
      const endDate = new Date(
        Date.now() + options.days * 24 * 60 * 60 * 1000
      );
      events = await fetchUSConcerts({
        startDate: new Date(),
        endDate,
        limit: options.limit,
      });
    }

    console.log(`Fetched ${events.length} events`);
  } catch (err) {
    console.error("Error fetching events:", err);
    await prisma.ingestionRun.update({
      where: { id: ingestionRun.id },
      data: {
        finishedAt: new Date(),
        errCount: 1,
        notes: `Error fetching events: ${String(err)}`,
      },
    });
    process.exit(1);
  }

  let okCount = 0;
  let errCount = 0;
  let safeTixCount = 0;
  let nonTransferableCount = 0;

  if (!options.dryRun) {
    console.log();
    console.log("Writing to database...");

    for (const event of events) {
      try {
        const artistId = await upsertArtist(event);
        const venueId = await upsertVenue(event);
        const eventId = await upsertEvent(event, venueId, artistId);
        await upsertIngestSource(event, eventId);

        if (event.resellability.isSafeTix) {
          safeTixCount++;
        }
        if (event.resellability.isNonTransferable) {
          nonTransferableCount++;
        }

        okCount++;
      } catch (err) {
        console.error(`Error processing event ${event.ticketmasterId}:`, err);
        errCount++;
      }
    }
  } else {
    console.log("(dry-run mode; not writing to database)");
    okCount = events.length;
    safeTixCount = events.filter((e) => e.resellability.isSafeTix).length;
    nonTransferableCount = events.filter(
      (e) => e.resellability.isNonTransferable
    ).length;
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
  console.log();
  console.log("========================================");
  console.log(`✓ Ingested ${okCount} events`);
  if (safeTixCount > 0) {
    console.log(`  • ${safeTixCount} SafeTix-protected`);
  }
  if (nonTransferableCount > 0) {
    console.log(`  • ${nonTransferableCount} non-transferable`);
  }
  if (errCount > 0) {
    console.log(`✗ ${errCount} errors`);
  }
  console.log();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
