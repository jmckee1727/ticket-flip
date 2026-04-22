// Comparable event finder: identify similar past events for projection context.

import type { PrismaClient } from "@/generated/prisma/client";
import type { Event, ResaleSnapshot, Venue, Artist } from "@/generated/prisma/client";

// ============================================================================
// Types
// ============================================================================

/**
 * A comparable event with its historical resale snapshots.
 */
export interface ComparableEvent {
  event: Event & { artist: Artist | null; venue: Venue };
  snapshots: ResaleSnapshot[];
}

/**
 * Options for finding comparables.
 */
export interface FindComparablesOptions {
  /** Maximum number of comparables to return. Defaults to 20. */
  limit?: number;
}

// ============================================================================
// Matching Criteria (priority order: later rules are weaker matches)
// ============================================================================

/**
 * Find comparable events for a target event.
 *
 * Matching priority (later rules are weaker):
 * 1. Same artist, any venue, past 24 months
 * 2. Same venue, similar capacity, past 24 months
 * 3. Same category (CONCERT vs FESTIVAL), similar face price range, past 12 months
 *
 * @param event - The target event to find comparables for
 * @param prisma - Prisma client
 * @param opts - Options (limit, etc)
 * @returns Array of comparable events with snapshots
 */
export async function findComparables(
  event: Event & { artist: Artist | null; venue: Venue },
  prisma: PrismaClient,
  opts: FindComparablesOptions = {}
): Promise<ComparableEvent[]> {
  const limit = opts.limit ?? 20;
  const now = new Date();
  const months24Ago = new Date(now.getTime() - 24 * 30 * 24 * 60 * 60 * 1000);
  const months12Ago = new Date(now.getTime() - 12 * 30 * 24 * 60 * 60 * 1000);

  const comparableIds = new Set<string>();

  // Priority 1: Same artist, any venue, past 24 months
  if (event.artistId) {
    const sameArtist = await prisma.event.findMany({
      where: {
        artistId: event.artistId,
        eventDate: {
          gte: months24Ago,
          lt: now,
        },
        id: { not: event.id }, // Exclude self
      },
      select: { id: true },
      take: limit,
    });

    sameArtist.forEach((e) => comparableIds.add(e.id));
  }

  // Priority 2: Same venue, similar capacity, past 24 months
  const targetCapacity = event.venue.capacity;
  const capacityRange = targetCapacity
    ? {
        gte: Math.floor(targetCapacity * 0.7),
        lte: Math.ceil(targetCapacity * 1.3),
      }
    : undefined;

  const sameVenue = await prisma.event.findMany({
    where: {
      venueId: event.venueId,
      eventDate: {
        gte: months24Ago,
        lt: now,
      },
      id: { not: event.id },
      ...(capacityRange && {
        venue: {
          capacity: capacityRange,
        },
      }),
    },
    select: { id: true },
    take: limit,
  });

  sameVenue.forEach((e) => comparableIds.add(e.id));

  // Priority 3: Same category, similar face price range, past 12 months
  const targetFaceMax = event.faceMaxUsd;
  const priceRange = targetFaceMax
    ? {
        gte: targetFaceMax * 0.5,
        lte: targetFaceMax * 2.0,
      }
    : undefined;

  const sameCategory = await prisma.event.findMany({
    where: {
      category: event.category,
      eventDate: {
        gte: months12Ago,
        lt: now,
      },
      id: { not: event.id },
      ...(priceRange && {
        faceMaxUsd: priceRange,
      }),
    },
    select: { id: true },
    take: limit,
  });

  sameCategory.forEach((e) => comparableIds.add(e.id));

  // Limit total to requested amount
  const limitedIds = Array.from(comparableIds).slice(0, limit);

  // Fetch full event data with artist, venue, and snapshots
  const comparables = await Promise.all(
    limitedIds.map(async (id) => {
      const eventData = await prisma.event.findUnique({
        where: { id },
        include: {
          artist: true,
          venue: true,
        },
      });

      if (!eventData) {
        return null;
      }

      const snapshots = await prisma.resaleSnapshot.findMany({
        where: { eventId: id },
        orderBy: { capturedAt: "asc" },
      });

      return {
        event: eventData,
        snapshots,
      };
    })
  );

  return comparables.filter((c): c is ComparableEvent => c !== null);
}
