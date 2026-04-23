// Projection algorithm plug-in point
// Users replace placeholderAlgorithm with their own comparables-based logic.

import type { Event, ResaleSnapshot, Venue, Artist } from "@/generated/prisma/client";
import { getTourPrior, normalizeArtist, DEFAULT_PRIOR } from "./tour-priors";

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Input provided to the projection algorithm for a single event.
 * Includes the event, historical comparables, and current resale snapshots.
 */
export interface ProjectionInput {
  /** The target event to project resale price for. */
  event: Event & { artist: Artist | null; venue: Venue };

  /**
   * Historical resale snapshots for similar events (same artist, venue, or category).
   * Each comparable includes the event data and its historical snapshot timeline.
   */
  comparables: Array<{
    event: Event & { artist: Artist | null; venue: Venue };
    snapshots: ResaleSnapshot[];
  }>;

  /**
   * Current/recent resale snapshots for this event, if any.
   * Will be empty at onsale time; populated as the event approaches.
   */
  ownSnapshots: ResaleSnapshot[];

  /** Fee assumptions that users can tune to match their platform costs. */
  fees: {
    sellerFeePct: number; // e.g. 0.10 for 10%
    buyerFeePct: number; // e.g. 0.10 for 10%
    paymentProcessingPct?: number; // optional additional fees
  };
}

/**
 * Output produced by the projection algorithm.
 * Describes the expected resale price, profit, and confidence level.
 */
export interface ProjectionOutput {
  /** Expected peak resale price in USD. */
  projectedPriceUsd: number;

  /**
   * Expected profit after fees: (projectedPriceUsd * (1 - sellerFeePct)) - faceValue
   * Null if face value is unknown.
   */
  projectedProfitUsd: number | null;

  /** Confidence score 0..1. Higher = more reliable. */
  confidence: number;

  /** Human-readable explanation and metadata. */
  reasoning: {
    /** 1-2 sentence summary of the projection logic. */
    summary: string;

    /** IDs of comparable events used in the calculation. */
    comparablesUsed: string[];

    /** Any adjustments applied (e.g., {'demand_boost': 1.15, 'venue_capacity_adjustment': 0.95}). */
    adjustmentsApplied?: Record<string, number>;

    /** Additional notes or caveats. */
    notes?: string;
  };
}

/**
 * Signature for a pluggable projection algorithm.
 * Returns either a promise or a synchronous result.
 */
export type ProjectionAlgorithm = (
  input: ProjectionInput
) => Promise<ProjectionOutput> | ProjectionOutput;

// ============================================================================
// Placeholder Algorithm
// ============================================================================

/**
 * Default placeholder algorithm: 1.3x face-value multiplier.
 * Replace this with your own comparables-based logic.
 *
 * Logic:
 * - If event.faceMaxUsd exists: projectedPrice = faceMaxUsd * 1.3
 * - If face is unknown: projectedPrice = undefined, confidence = 0
 * - Profit = projectedPrice * (1 - sellerFeePct) - faceMaxUsd
 * - Confidence = 0.1 (very low; it's just a placeholder)
 */
export const placeholderAlgorithm: ProjectionAlgorithm = (input) => {
  const { event, fees } = input;

  // If face value is unknown, we cannot project
  if (!event.faceMaxUsd) {
    return {
      projectedPriceUsd: 0,
      projectedProfitUsd: null,
      confidence: 0,
      reasoning: {
        summary:
          "Unable to project: face value unknown. Placeholder algorithm requires faceMaxUsd.",
        comparablesUsed: [],
        notes: "Replace this placeholder with a real comparables-based algorithm.",
      },
    };
  }

  // Simple 1.3x multiplier on face max
  const projectedPriceUsd = event.faceMaxUsd * 1.3;

  // Calculate profit after fees
  const sellerProceeds = projectedPriceUsd * (1 - fees.sellerFeePct);
  const projectedProfitUsd = sellerProceeds - event.faceMaxUsd;

  return {
    projectedPriceUsd,
    projectedProfitUsd,
    confidence: 0.1, // Very low confidence
    reasoning: {
      summary: "Placeholder 1.3x face-value multiplier. Replace with a real algorithm.",
      comparablesUsed: [],
      adjustmentsApplied: {
        face_multiplier: 1.3,
      },
      notes:
        "This is a trivial placeholder. Implement a real algorithm using comparables analysis.",
    },
  };
};

// ============================================================================
// Comparables-Based Algorithm (v1)
// ============================================================================

/**
 * Strength of match for a comparable. Drives the weight each comparable gets
 * when we aggregate peak-to-face ratios. Same artist is by far the strongest
 * signal — same tour usually means same production cost, same demand curve.
 * Same venue adjusts for market/capacity. Same category is the weakest tier.
 */
function matchQualityWeight(
  target: ProjectionInput["event"],
  comp: ProjectionInput["comparables"][number]["event"]
): { weight: number; tier: "artist" | "venue" | "category" } {
  if (target.artistId && comp.artistId && target.artistId === comp.artistId) {
    return { weight: 1.0, tier: "artist" };
  }
  if (target.venueId === comp.venueId) {
    return { weight: 0.5, tier: "venue" };
  }
  return { weight: 0.25, tier: "category" };
}

/**
 * Comparables further in the past tell us less about today's market. Linear
 * decay from 1.0 at 0 months to 0.3 at 24 months, floored at 0.3.
 */
function recencyWeight(compEventDate: Date, now: Date): number {
  const monthsAgo =
    (now.getTime() - compEventDate.getTime()) / (30 * 24 * 60 * 60 * 1000);
  if (monthsAgo <= 0) return 1.0;
  const decayed = 1.0 - (monthsAgo / 24) * 0.7;
  return Math.max(0.3, decayed);
}

/**
 * Peak resale price observed for a comparable across its pre-event window.
 * The "peak" is the 90th-percentile snapshot in the 30 days leading up to
 * the event date, not the absolute max — which tends to be a thin outlier
 * listing. Falls back to max if fewer than ~3 snapshots.
 */
function computePeakPrice(snapshots: ResaleSnapshot[]): number | null {
  if (snapshots.length === 0) return null;

  const prices = snapshots
    .map((s) => s.priceAvgUsd)
    .filter((p): p is number => typeof p === "number" && p > 0)
    .sort((a, b) => a - b);

  if (prices.length === 0) return null;
  if (prices.length < 3) return prices[prices.length - 1];

  const p90Idx = Math.min(
    prices.length - 1,
    Math.floor(prices.length * 0.9)
  );
  return prices[p90Idx];
}

/**
 * Comparables-based algorithm.
 *
 * Gathers peak-to-face ratios from matched comparable events, weights them by
 * match quality and recency, blends in a tour-level prior for the artist, and
 * projects a peak resale price from the weighted ratio.
 *
 * When face is unknown: projects an absolute peak price from the median of
 * comparables' peak prices, with a confidence penalty.
 */
export const comparablesAlgorithm: ProjectionAlgorithm = (input) => {
  const { event, comparables, ownSnapshots, fees } = input;
  const now = new Date();

  // Gather ratios from comparables that have both snapshots and a face value.
  type RatioSample = {
    ratio: number;
    weight: number;
    tier: "artist" | "venue" | "category";
    compId: string;
  };
  const samples: RatioSample[] = [];

  for (const comp of comparables) {
    const peakPrice = computePeakPrice(comp.snapshots);
    if (peakPrice == null) continue;

    const compFace = comp.event.faceMaxUsd ?? comp.event.faceMinUsd;
    if (!compFace || compFace <= 0) continue;

    const ratio = peakPrice / compFace;

    // Clamp outliers: ratios below 0.5 usually mean an unsold event we
    // don't want to learn from; above 10x is almost always bad data.
    if (ratio < 0.5 || ratio > 10) continue;

    const { weight: matchW, tier } = matchQualityWeight(event, comp.event);
    const recencyW = recencyWeight(comp.event.eventDate, now);
    const weight = matchW * recencyW;

    samples.push({ ratio, weight, tier, compId: comp.event.id });
  }

  // Tour-level prior (seeded). Always blended in at a fixed weight so the
  // algorithm has a sensible anchor even when the comparable set is empty.
  const prior = getTourPrior(event.artist?.name ?? null);
  const priorSample: RatioSample = {
    ratio: prior.ratio,
    weight: prior.confidence,
    tier: "category" as const,
    compId: "prior",
  };

  const allSamples = [...samples, priorSample];
  const totalWeight = allSamples.reduce((s, x) => s + x.weight, 0);
  const weightedRatio =
    totalWeight > 0
      ? allSamples.reduce((s, x) => s + x.ratio * x.weight, 0) / totalWeight
      : prior.ratio;

  // Confidence scales with how much real-signal weight we have, diminishing
  // as the prior dominates. Tier mix matters — all-artist is the best case.
  const artistMatchCount = samples.filter((s) => s.tier === "artist").length;
  const nonPriorWeight = samples.reduce((s, x) => s + x.weight, 0);
  const signalShare =
    totalWeight > 0 ? nonPriorWeight / totalWeight : 0;

  let confidence = 0.1 + 0.5 * signalShare + 0.05 * Math.min(artistMatchCount, 5);
  // Snapshot-on-target-event boost: if we already have live snapshots for
  // this exact event, that's the strongest possible signal.
  if (ownSnapshots.length >= 3) confidence += 0.15;
  confidence = Math.min(0.85, Math.max(0.05, confidence));

  // Project price. Path A: face-anchored. Path B: median of comparable peaks.
  const faceAnchor = event.faceMaxUsd ?? event.faceMinUsd ?? null;
  let projectedPriceUsd: number;
  let projectionPath: "face-ratio" | "comparable-median" | "prior-only";

  if (faceAnchor && faceAnchor > 0) {
    projectedPriceUsd = faceAnchor * weightedRatio;
    projectionPath = "face-ratio";
  } else if (samples.length > 0) {
    // No face: use the weighted median of the comparables' peak prices.
    const peaks = comparables
      .map((c) => computePeakPrice(c.snapshots))
      .filter((p): p is number => p != null)
      .sort((a, b) => a - b);

    if (peaks.length > 0) {
      projectedPriceUsd = peaks[Math.floor(peaks.length / 2)];
      projectionPath = "comparable-median";
      confidence *= 0.7; // face-less projections are weaker
    } else {
      projectedPriceUsd = 0;
      projectionPath = "prior-only";
      confidence = 0.05;
    }
  } else {
    projectedPriceUsd = 0;
    projectionPath = "prior-only";
    confidence = 0.05;
  }

  // Profit (requires face value)
  let projectedProfitUsd: number | null = null;
  if (faceAnchor && faceAnchor > 0 && projectedPriceUsd > 0) {
    const totalFeePct =
      fees.sellerFeePct + (fees.paymentProcessingPct ?? 0);
    const sellerProceeds = projectedPriceUsd * (1 - totalFeePct);
    projectedProfitUsd = sellerProceeds - faceAnchor;
  }

  const tierBreakdown = samples.reduce(
    (acc, s) => {
      acc[s.tier] = (acc[s.tier] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const priorLabel =
    prior === DEFAULT_PRIOR
      ? "baseline"
      : normalizeArtist(event.artist?.name ?? null) || "tour-level";

  const summary =
    projectionPath === "face-ratio"
      ? `Projected $${projectedPriceUsd.toFixed(0)} from ${samples.length} comparable(s) (${
          tierBreakdown.artist ?? 0
        } same-artist, ${tierBreakdown.venue ?? 0} same-venue) × weighted ratio ${weightedRatio.toFixed(2)}, blended with ${priorLabel} prior (${prior.ratio.toFixed(2)}x).`
      : projectionPath === "comparable-median"
        ? `No face value on this event; projected $${projectedPriceUsd.toFixed(0)} as median of ${samples.length} comparable peak price(s).`
        : `No comparables and no face value; defaulting to prior-only estimate (very low confidence).`;

  return {
    projectedPriceUsd: Math.round(projectedPriceUsd * 100) / 100,
    projectedProfitUsd:
      projectedProfitUsd == null
        ? null
        : Math.round(projectedProfitUsd * 100) / 100,
    confidence: Math.round(confidence * 1000) / 1000,
    reasoning: {
      summary,
      comparablesUsed: samples.map((s) => s.compId),
      adjustmentsApplied: {
        weighted_ratio: Number(weightedRatio.toFixed(3)),
        prior_ratio: prior.ratio,
        signal_share: Number(signalShare.toFixed(3)),
      },
      notes: `path=${projectionPath}; prior_source="${prior.source}"; own_snapshots=${ownSnapshots.length}; tier_mix=${JSON.stringify(tierBreakdown)}`,
    },
  };
};

// ============================================================================
// Algorithm Registry
// ============================================================================

/**
 * Registry of available algorithms.
 * Add your algorithms here as name -> {name, version, fn}.
 *
 * Use semantic versioning so old projections stay comparable over time.
 */
export const algorithms: Record<
  string,
  {
    name: string;
    version: string;
    fn: ProjectionAlgorithm;
  }
> = {
  placeholder_1_3x: {
    name: "placeholder_1_3x",
    version: "0.1.0",
    fn: placeholderAlgorithm,
  },
  comparables_v1: {
    name: "comparables_v1",
    version: "1.0.0",
    fn: comparablesAlgorithm,
  },
};

/**
 * Get an algorithm by name.
 * @param algorithmName - The name of the algorithm (e.g., 'placeholder_1_3x')
 * @throws If the algorithm is not found.
 */
export function getAlgorithm(algorithmName: string) {
  const algo = algorithms[algorithmName];
  if (!algo) {
    throw new Error(
      `Unknown algorithm: ${algorithmName}. Available: ${Object.keys(algorithms).join(", ")}`
    );
  }
  return algo;
}
