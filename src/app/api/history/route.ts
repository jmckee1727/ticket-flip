import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

interface QueryParams {
  search?: string;
  category?: string;
  state?: string;
  page?: string;
  pageSize?: string;
  sortBy?: string;
  sortDir?: string;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query: QueryParams = {};

    // Extract query params
    if (searchParams.has("search")) {
      query.search = searchParams.get("search") || "";
    }
    if (searchParams.has("category")) {
      query.category = searchParams.get("category") || "all";
    }
    if (searchParams.has("state")) {
      query.state = searchParams.get("state") || "all";
    }
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = parseInt(searchParams.get("pageSize") || "50", 10);
    const sortBy = searchParams.get("sortBy") || "date";
    const sortDir = (searchParams.get("sortDir") || "desc") as "asc" | "desc";

    // Build where clause
    const where: Record<string, unknown> = {};

    if (query.search) {
      const searchTerm = query.search.toLowerCase();
      where.OR = [
        {
          name: {
            contains: searchTerm,
            mode: "insensitive",
          },
        },
        {
          artist: {
            name: {
              contains: searchTerm,
              mode: "insensitive",
            },
          },
        },
        {
          venue: {
            name: {
              contains: searchTerm,
              mode: "insensitive",
            },
          },
        },
        {
          venue: {
            city: {
              contains: searchTerm,
              mode: "insensitive",
            },
          },
        },
      ];
    }

    if (query.category && query.category !== "all") {
      where.category = query.category;
    }

    if (query.state && query.state !== "all") {
      where.venue = {
        ...((where.venue as Record<string, unknown>) || {}),
        state: query.state,
      };
    }

    // Build order by
    let orderBy: Record<string, unknown> = {};
    if (sortBy === "date") {
      orderBy = { eventDate: sortDir };
    } else if (sortBy === "name") {
      orderBy = { name: sortDir };
    } else if (sortBy === "venue") {
      orderBy = { venue: { name: sortDir } };
    }

    // Count total
    const total = await prisma.event.count({ where });

    // Fetch events
    const events = await prisma.event.findMany({
      where,
      include: {
        artist: true,
        venue: true,
        snapshots: {
          orderBy: { capturedAt: "desc" },
          take: 1,
        },
      },
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    // Map snapshots to latestSnapshot
    const eventsWithSnapshot = events.map((event) => ({
      ...event,
      latestSnapshot: event.snapshots[0] || null,
      snapshots: undefined,
    }));

    const totalPages = Math.ceil(total / pageSize);

    return NextResponse.json({
      events: eventsWithSnapshot,
      total,
      page,
      pageSize,
      totalPages,
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch events" },
      { status: 500 }
    );
  }
}
