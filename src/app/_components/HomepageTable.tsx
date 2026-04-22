"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type {
  Event,
  Artist,
  Venue,
  Projection,
} from "@/generated/prisma/client";
import { formatDateTime, getRelativeTimeHint, formatMoney, formatPriceRange } from "@/lib/format";
import { ResellabilityBadges } from "./ResellabilityBadges";

interface EventWithRelations extends Event {
  artist: Artist | null;
  venue: Venue;
  projections: Projection[];
}

interface HomepageTableProps {
  events: EventWithRelations[];
}

export function HomepageTable({ events }: HomepageTableProps) {
  const [dateRange, setDateRange] = useState<"7" | "30" | "90" | "all">("all");
  const [category, setCategory] = useState<"all" | "CONCERT" | "FESTIVAL">(
    "all"
  );
  const [hideNonFlippable, setHideNonFlippable] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Compute date boundary
  const now = new Date();
  const dayLimit = {
    "7": 7,
    "30": 30,
    "90": 90,
    all: Infinity,
  }[dateRange];

  // Filter and search
  const filtered = useMemo(() => {
    return events.filter((event) => {
      // Always hide on-sales that already happened — the homepage is for
      // upcoming drops. Past on-sales live on the history page.
      const daysUntil =
        (event.onsaleStart!.getTime() - now.getTime()) /
        (1000 * 60 * 60 * 24);
      if (daysUntil < 0) return false;

      // Date range filter (upper bound)
      if (dayLimit !== Infinity && daysUntil > dayLimit) return false;

      // Category filter
      if (category !== "all" && event.category !== category) {
        return false;
      }

      // Non-flippable filter
      if (
        hideNonFlippable &&
        (event.isSafeTix || event.isNonTransferable)
      ) {
        return false;
      }

      // Search filter (artist or venue)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const artistMatch = event.artist?.name.toLowerCase().includes(query);
        const venueMatch = event.venue.name.toLowerCase().includes(query);
        if (!artistMatch && !venueMatch) return false;
      }

      return true;
    });
  }, [events, dateRange, category, hideNonFlippable, searchQuery]);

  const isNonFlippable = (event: EventWithRelations) => {
    return event.isSafeTix || event.isNonTransferable;
  };

  return (
    <div className="space-y-6">
      {/* Filter Bar */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
        {/* Search */}
        <div>
          <input
            type="text"
            placeholder="Search by artist or venue..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Filters row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Date range */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              On-Sale Date
            </label>
            <select
              value={dateRange}
              onChange={(e) =>
                setDateRange(e.target.value as "7" | "30" | "90" | "all")
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="7">Next 7 days</option>
              <option value="30">Next 30 days</option>
              <option value="90">Next 90 days</option>
              <option value="all">All upcoming</option>
            </select>
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Category
            </label>
            <select
              value={category}
              onChange={(e) =>
                setCategory(e.target.value as "all" | "CONCERT" | "FESTIVAL")
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All categories</option>
              <option value="CONCERT">Concerts</option>
              <option value="FESTIVAL">Festivals</option>
            </select>
          </div>

          {/* Hide non-flippable */}
          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={hideNonFlippable}
                onChange={(e) => setHideNonFlippable(e.target.checked)}
                className="rounded border-gray-300"
              />
              <span className="text-sm font-medium text-gray-700">
                Hide non-flippable
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* Results count */}
      <div className="text-sm text-gray-600">
        Showing {filtered.length} of {events.length} events
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-gray-900">
                On-Sale
              </th>
              <th className="text-left px-4 py-3 font-semibold text-gray-900">
                Event
              </th>
              <th className="text-left px-4 py-3 font-semibold text-gray-900">
                Venue
              </th>
              <th className="text-left px-4 py-3 font-semibold text-gray-900">
                Date
              </th>
              <th className="text-left px-4 py-3 font-semibold text-gray-900">
                Face
              </th>
              <th className="text-left px-4 py-3 font-semibold text-gray-900">
                Projection
              </th>
              <th className="text-left px-4 py-3 font-semibold text-gray-900">
                Profit
              </th>
              <th className="text-left px-4 py-3 font-semibold text-gray-900">
                Flags
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  No events match your filters
                </td>
              </tr>
            ) : (
              filtered.map((event) => {
                const nonFlippable = isNonFlippable(event);
                const projection = event.projections[0];

                return (
                  <tr
                    key={event.id}
                    className={`border-gray-100 hover:bg-gray-50 ${
                      nonFlippable ? "opacity-60 bg-gray-50" : ""
                    }`}
                    title={
                      nonFlippable
                        ? "Non-flippable: SafeTix and/or non-transferable restrictions"
                        : ""
                    }
                  >
                    {/* On-Sale */}
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">
                        {event.onsaleStart
                          ? formatDateTime(event.onsaleStart)
                          : "—"}
                      </div>
                      {event.onsaleStart && (
                        <div className="text-xs text-gray-500">
                          {getRelativeTimeHint(event.onsaleStart)}
                        </div>
                      )}
                    </td>

                    {/* Event */}
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">
                        {event.name}
                      </div>
                      {event.artist && (
                        <div className="text-xs text-gray-600">
                          {event.artist.name}
                        </div>
                      )}
                    </td>

                    {/* Venue */}
                    <td className="px-4 py-3 text-gray-700">
                      {event.venue.name}
                      {event.venue.city && (
                        <div className="text-xs text-gray-600">
                          {event.venue.city}
                          {event.venue.state && `, ${event.venue.state}`}
                        </div>
                      )}
                    </td>

                    {/* Event Date */}
                    <td className="px-4 py-3 text-gray-700">
                      {formatDateTime(event.eventDate)}
                    </td>

                    {/* Face Price */}
                    <td className="px-4 py-3 text-gray-700">
                      {formatPriceRange(event.faceMinUsd, event.faceMaxUsd)}
                    </td>

                    {/* Projection */}
                    <td className="px-4 py-3">
                      {projection && projection.confidence && projection.confidence > 0 ? (
                        <Link
                          href={`/events/${event.id}`}
                          className="text-blue-600 hover:text-blue-900 font-medium"
                          title={`Confidence: ${(projection.confidence * 100).toFixed(0)}%`}
                        >
                          {formatMoney(projection.projectedPriceUsd)}
                        </Link>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>

                    {/* Profit */}
                    <td className="px-4 py-3">
                      {projection && projection.projectedProfitUsd !== null ? (
                        <span
                          className={
                            projection.projectedProfitUsd > 0
                              ? "text-green-700 font-medium"
                              : "text-red-700 font-medium"
                          }
                        >
                          {formatMoney(projection.projectedProfitUsd)}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>

                    {/* Flags */}
                    <td className="px-4 py-3">
                      <ResellabilityBadges event={event} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
