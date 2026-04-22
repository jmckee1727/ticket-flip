import Link from "next/link";
import type { ComparableEvent } from "@/lib/comparables";
import { formatDate, formatMoney } from "@/lib/format";

interface ComparablesListProps {
  comparables: ComparableEvent[];
}

export function ComparablesList({ comparables }: ComparablesListProps) {
  if (comparables.length === 0) {
    return (
      <p className="text-gray-600">No comparable events found</p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead className="bg-gray-100 border-b border-gray-200">
          <tr>
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
              Recent Resale Median
            </th>
            <th className="text-left px-4 py-3 font-semibold text-gray-900">
              Link
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {comparables.map((comparable) => {
            const latestSnapshot = comparable.snapshots[
              comparable.snapshots.length - 1
            ] || null;
            return (
              <tr key={comparable.event.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">
                    {comparable.event.name}
                  </div>
                  {comparable.event.artist && (
                    <div className="text-xs text-gray-600">
                      {comparable.event.artist.name}
                    </div>
                  )}
                </td>

                <td className="px-4 py-3 text-gray-700">
                  {comparable.event.venue.name}
                  {comparable.event.venue.city && (
                    <div className="text-xs text-gray-600">
                      {comparable.event.venue.city}
                      {comparable.event.venue.state &&
                        `, ${comparable.event.venue.state}`}
                    </div>
                  )}
                </td>

                <td className="px-4 py-3 text-gray-700">
                  {formatDate(comparable.event.eventDate)}
                </td>

                <td className="px-4 py-3 text-gray-700">
                  {comparable.event.faceMaxUsd
                    ? formatMoney(comparable.event.faceMaxUsd)
                    : "—"}
                </td>

                <td className="px-4 py-3 font-semibold text-gray-900">
                  {latestSnapshot?.priceMedianUsd
                    ? formatMoney(latestSnapshot.priceMedianUsd)
                    : "—"}
                </td>

                <td className="px-4 py-3">
                  <Link
                    href={`/events/${comparable.event.id}`}
                    className="text-blue-600 hover:text-blue-900 font-medium"
                  >
                    View →
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
