// Projection algorithm plug-in point
// Users replace placeholderAlgorithm with their own comparables-based logic.

import type { Event, ResaleSnapshot, Venue, Artist } from "@/generated/prisma/client";

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
