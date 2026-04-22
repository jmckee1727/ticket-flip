"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import type { Event, Artist, Venue, ResaleSnapshot } from "@/generated/prisma/client";
import { formatDate, formatMoney } from "@/lib/format";

interface EventWithRelations extends Event {
  artist: Artist | null;
  venue: Venue;
  latestSnapshot: ResaleSnapshot | null;
}

interface HistoryResponse {
  events: EventWithRelations[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const ITEMS_PER_PAGE = 50;

export function HistoryBrowser() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Get filter params
  const search = searchParams.get("search") || "";
  const category = searchParams.get("category") || "all";
  const state = searchParams.get("state") || "all";
  const page = parseInt(searchParams.get("page") || "1", 10);
  const sortBy = searchParams.get("sortBy") || "date";
  const sortDir = searchParams.get("sortDir") || "desc";

  useEffect(() => {
    const fetchEvents = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          search,
          category,
          state,
          page: page.toString(),
          pageSize: ITEMS_PER_PAGE.toString(),
          sortBy,
          sortDir,
        });

        const res = await fetch(`/api/history?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to fetch");
        const json = (await res.json()) as HistoryResponse;
        setData(json);
      } catch (error) {
        console.error("Error fetching history:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchEvents();
  }, [search, category, state, page, sortBy, sortDir]);

  const updateSearchParam = (
    key: string,
    value: string,
    resetPage = true
  ) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    if (resetPage) {
      params.delete("page");
    }
    router.push(`/history?${params.toString()}`);
  };

  const handleSort = (newSort: string) => {
    if (sortBy === newSort) {
      // Toggle direction
      updateSearchParam(
        "sortDir",
        sortDir === "asc" ? "desc" : "asc",
        false
      );
    } else {
      // New sort column
      updateSearchParam("sortBy", newSort, false);
      updateSearchParam("sortDir", "desc", false);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  if (!data) {
    return <div className="text-center py-8 text-red-600">Error loading events</div>;
  }

  const states = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"];

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
        {/* Search */}
        <div>
          <input
            type="text"
            placeholder="Search by artist, venue, event, or city..."
            value={search}
            onChange={(e) => updateSearchParam("search", e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Filter row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => updateSearchParam("category", e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All categories</option>
              <option value="CONCERT">Concerts</option>
              <option value="FESTIVAL">Festivals</option>
            </select>
          </div>

          {/* State */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              State
            </label>
            <select
              value={state}
              onChange={(e) => updateSearchParam("state", e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All states</option>
              {states.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Sort */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Sort
            </label>
            <select
              value={sortBy}
              onChange={(e) => updateSearchParam("sortBy", e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="date">Event Date</option>
              <option value="name">Event Name</option>
              <option value="venue">Venue</option>
            </select>
          </div>
        </div>
      </div>

      {/* Results count */}
      <div className="text-sm text-gray-600">
        Showing {Math.min((page - 1) * ITEMS_PER_PAGE + 1, data.total)}-
        {Math.min(page * ITEMS_PER_PAGE, data.total)} of {data.total} events
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 border-b border-gray-200">
            <tr>
              <th
                className="text-left px-4 py-3 font-semibold text-gray-900 cursor-pointer hover:bg-gray-200"
                onClick={() => handleSort("date")}
              >
                Date
                {sortBy === "date" && (
                  <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>
                )}
              </th>
              <th
                className="text-left px-4 py-3 font-semibold text-gray-900 cursor-pointer hover:bg-gray-200"
                onClick={() => handleSort("name")}
              >
                Event
                {sortBy === "name" && (
                  <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>
                )}
              </th>
              <th className="text-left px-4 py-3 font-semibold text-gray-900">
                Artist
              </th>
              <th
                className="text-left px-4 py-3 font-semibold text-gray-900 cursor-pointer hover:bg-gray-200"
                onClick={() => handleSort("venue")}
              >
                Venue
                {sortBy === "venue" && (
                  <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>
                )}
              </th>
              <th className="text-left px-4 py-3 font-semibold text-gray-900">
                City
              </th>
              <th className="text-left px-4 py-3 font-semibold text-gray-900">
                Face
              </th>
              <th className="text-left px-4 py-3 font-semibold text-gray-900">
                Recent Resale Median
              </th>
              <th className="text-left px-4 py-3 font-semibold text-gray-900">
                Link
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {data.events.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  No events found
                </td>
              </tr>
            ) : (
              data.events.map((event) => (
                <tr key={event.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-700">
                    {formatDate(event.eventDate)}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {event.name}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {event.artist?.name || "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {event.venue.name}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {event.venue.city || "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {event.faceMaxUsd
                      ? formatMoney(event.faceMaxUsd)
                      : "—"}
                  </td>
                  <td className="px-4 py-3 font-semibold text-gray-900">
                    {event.latestSnapshot?.priceMedianUsd
                      ? formatMoney(event.latestSnapshot.priceMedianUsd)
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/events/${event.id}`}
                      className="text-blue-600 hover:text-blue-900 font-medium"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          {page > 1 && (
            <button
              onClick={() =>
                updateSearchParam("page", (page - 1).toString(), false)
              }
              className="px-3 py-2 rounded border border-gray-300 hover:bg-gray-100"
            >
              ← Previous
            </button>
          )}

          <div className="text-sm text-gray-600">
            Page {page} of {data.totalPages}
          </div>

          {page < data.totalPages && (
            <button
              onClick={() =>
                updateSearchParam("page", (page + 1).toString(), false)
              }
              className="px-3 py-2 rounded border border-gray-300 hover:bg-gray-100"
            >
              Next →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
