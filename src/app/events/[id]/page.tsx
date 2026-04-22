import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDateTime, formatDate, formatMoney, formatPriceRange } from "@/lib/format";
import { ResellabilityBadges } from "@/app/_components/ResellabilityBadges";
import { PriceChart } from "@/app/_components/PriceChart";
import { ComparablesList } from "@/app/_components/ComparablesList";
import { findComparables } from "@/lib/comparables";

interface Params {
  id: string;
}

async function getEventDetail(id: string) {
  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      artist: true,
      venue: true,
      projections: {
        orderBy: { computedAt: "desc" },
        take: 1,
      },
      snapshots: {
        orderBy: { capturedAt: "asc" },
      },
    },
  });

  return event;
}

export default async function EventDetail({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const event = await getEventDetail(id);

  if (!event) {
    notFound();
  }

  const projection = event.projections[0];
  let comparables: Awaited<ReturnType<typeof findComparables>> = [];
  try {
    comparables = await findComparables(event, prisma, { limit: 5 });
  } catch (error) {
    console.error("Error finding comparables:", error);
  }

  // Parse reasoning JSON if available
  let reasoning = null;
  if (projection && projection.reasoningJson) {
    try {
      reasoning = JSON.parse(projection.reasoningJson);
    } catch (error) {
      console.error("Error parsing reasoning JSON:", error);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">{event.name}</h1>
        {event.artist && (
          <p className="text-lg text-gray-600 mb-4">{event.artist.name}</p>
        )}

        <div className="space-y-2 text-gray-700 mb-4">
          <p>
            <span className="font-semibold">Venue:</span> {event.venue.name}
            {event.venue.city && ` · ${event.venue.city}`}
            {event.venue.state && `, ${event.venue.state}`}
          </p>
          <p>
            <span className="font-semibold">Event Date:</span>{" "}
            {formatDateTime(event.eventDate)}
          </p>
          {event.primaryUrl && (
            <p>
              <a
                href={event.primaryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:text-blue-900 font-medium"
              >
                Go to on-sale →
              </a>
            </p>
          )}
        </div>
      </div>

      {/* Metadata strip */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-4">
          <div>
            <div className="text-sm text-gray-600">Face Price</div>
            <div className="text-lg font-semibold text-gray-900">
              {formatPriceRange(event.faceMinUsd, event.faceMaxUsd)}
            </div>
          </div>

          <div>
            <div className="text-sm text-gray-600">On-Sale Window</div>
            <div className="text-sm text-gray-900">
              {event.onsaleStart && event.onsaleEnd
                ? `${formatDate(event.onsaleStart)} – ${formatDate(
                    event.onsaleEnd
                  )}`
                : event.onsaleStart
                  ? `from ${formatDate(event.onsaleStart)}`
                  : "—"}
            </div>
          </div>

          <div>
            <div className="text-sm text-gray-600">Presale Window</div>
            <div className="text-sm text-gray-900">
              {event.presaleStart && event.presaleEnd
                ? `${formatDate(event.presaleStart)} – ${formatDate(
                    event.presaleEnd
                  )}`
                : event.presaleStart
                  ? `from ${formatDate(event.presaleStart)}`
                  : "—"}
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-4">
          <div className="font-semibold text-gray-900 mb-2">Resellability</div>
          <ResellabilityBadges event={event} />
          {event.resalePriceCap && (
            <p className="text-sm text-gray-600 mt-2">
              Resale price capped at {formatMoney(event.resalePriceCap)}
            </p>
          )}
        </div>
      </div>

      {/* Projection Section */}
      {projection && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4">
            Price Projection
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-4">
            <div>
              <div className="text-sm text-gray-600">Projected Peak Price</div>
              <div className="text-2xl font-bold text-gray-900">
                {formatMoney(projection.projectedPriceUsd)}
              </div>
            </div>

            <div>
              <div className="text-sm text-gray-600">Projected Profit</div>
              <div
                className={`text-2xl font-bold ${
                  projection.projectedProfitUsd && projection.projectedProfitUsd > 0
                    ? "text-green-700"
                    : "text-red-700"
                }`}
              >
                {projection.projectedProfitUsd !== null
                  ? formatMoney(projection.projectedProfitUsd)
                  : "—"}
              </div>
            </div>

            <div>
              <div className="text-sm text-gray-600">Confidence</div>
              <div className="text-2xl font-bold text-gray-900">
                {projection.confidence !== null
                  ? (projection.confidence * 100).toFixed(0)
                  : "—"}
                %
              </div>
            </div>
          </div>

          {reasoning && (
            <div className="border-t border-gray-200 pt-4">
              <p className="text-gray-700 mb-2">{reasoning.summary}</p>
              {reasoning.comparablesUsed && reasoning.comparablesUsed.length > 0 && (
                <div className="text-sm text-gray-600 mt-2">
                  <span className="font-semibold">Comparables used:</span>{" "}
                  {reasoning.comparablesUsed.length}
                </div>
              )}
              {reasoning.notes && (
                <p className="text-sm text-gray-600 mt-2">{reasoning.notes}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Historical Snapshots Chart */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
        <h2 className="text-xl font-bold text-gray-900 mb-4">
          Historical Resale Data
        </h2>
        {event.snapshots.length > 0 ? (
          <PriceChart snapshots={event.snapshots} />
        ) : (
          <div className="text-gray-600 py-8 text-center">
            <p className="mb-2">No resale data yet</p>
            <p className="text-sm text-gray-500">
              Snapshots begin once the event is closer to the date and secondary
              market data is available.
            </p>
          </div>
        )}
      </div>

      {/* Comparables */}
      {comparables.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">
            Similar Events
          </h2>
          <ComparablesList comparables={comparables} />
        </div>
      )}

      {/* Back Link */}
      <div className="mt-8">
        <Link
          href="/"
          className="text-blue-600 hover:text-blue-900 font-medium"
        >
          ← Back to today's on-sales
        </Link>
      </div>
    </div>
  );
}
