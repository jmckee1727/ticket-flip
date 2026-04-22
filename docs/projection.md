# Projection Algorithm

The projection system provides a clean plug-in point where you can insert your own resale-price prediction algorithm. This document describes the interface and how to customize it.

## Overview

The projection pipeline:
1. **Selector**: Chooses events to project (upcoming, all, or specific event)
2. **Comparables**: Finds similar historical events for context
3. **Algorithm**: Your custom logic that returns `projectedPriceUsd`, `projectedProfitUsd`, and a `confidence` score
4. **Persistence**: Saves projections to the database for accuracy tracking

## Core Interfaces

### `ProjectionInput`

Data provided to your algorithm for a single event:

```typescript
interface ProjectionInput {
  // The target event to project for
  event: Event & { artist: Artist | null; venue: Venue };

  // Similar historical events with their resale snapshots
  comparables: Array<{
    event: Event & { artist: Artist | null; venue: Venue };
    snapshots: ResaleSnapshot[];
  }>;

  // Current resale snapshots for this event (empty at onsale time)
  ownSnapshots: ResaleSnapshot[];

  // Fee assumptions (tunable)
  fees: {
    sellerFeePct: number;    // e.g. 0.10
    buyerFeePct: number;     // e.g. 0.10
    paymentProcessingPct?: number;
  };
}
```

### `ProjectionOutput`

What your algorithm must return:

```typescript
interface ProjectionOutput {
  // Expected peak resale price
  projectedPriceUsd: number;

  // Profit after fees: (projectedPrice * (1 - sellerFee)) - faceValue
  // null if face value unknown
  projectedProfitUsd: number | null;

  // Confidence 0..1 (higher = more reliable)
  confidence: number;

  // Explanation for auditing
  reasoning: {
    summary: string;                    // 1-2 sentences
    comparablesUsed: string[];          // event IDs
    adjustmentsApplied?: Record<string, number>;
    notes?: string;
  };
}
```

## Comparables Matching

The `findComparables()` function ranks similar events by priority:

1. **Same artist, any venue** (past 24 months) — strongest signal
2. **Same venue, similar capacity** (past 24 months) — strong signal
3. **Same category + similar price range** (past 12 months) — weaker signal

Each rule returns up to 20 matches. Comparables are merged and deduplicated.

### Capacity Similarity

Venue capacity is considered "similar" if within ±30% of the target.

### Price Range Similarity

Face price is considered "similar" if within 0.5x to 2.0x of the target's `faceMaxUsd`.

## Default Algorithm (Placeholder)

The repo ships with a trivial placeholder:

```typescript
export const placeholderAlgorithm = (input: ProjectionInput) => {
  if (!input.event.faceMaxUsd) {
    return {
      projectedPriceUsd: 0,
      projectedProfitUsd: null,
      confidence: 0,
      reasoning: {
        summary: "Face value unknown.",
        comparablesUsed: [],
      },
    };
  }

  const projectedPriceUsd = input.event.faceMaxUsd * 1.3;
  const sellerProceeds = projectedPriceUsd * (1 - input.fees.sellerFeePct);
  const projectedProfitUsd = sellerProceeds - input.event.faceMaxUsd;

  return {
    projectedPriceUsd,
    projectedProfitUsd,
    confidence: 0.1,  // Very low
    reasoning: {
      summary: "Placeholder 1.3x face-value multiplier. Replace with real algorithm.",
      comparablesUsed: [],
      adjustmentsApplied: { face_multiplier: 1.3 },
    },
  };
};
```

**Replace this with your own logic.**

## Implementing Your Algorithm

### Step 1: Edit `src/lib/projection.ts`

Add your algorithm function:

```typescript
export const myAlgorithm: ProjectionAlgorithm = (input) => {
  const { event, comparables, ownSnapshots, fees } = input;

  // 1. Analyze comparables
  const recentPrices = comparables.flatMap((c) =>
    c.snapshots.map((s) => s.priceMedianUsd).filter(Boolean)
  );

  // 2. Calculate expected price
  const avgComparablePrice = recentPrices.length > 0
    ? recentPrices.reduce((a, b) => a + b) / recentPrices.length
    : event.faceMaxUsd ?? 0;

  const projectedPriceUsd = avgComparablePrice * 1.2;  // Apply demand multiplier

  // 3. Calculate profit
  const sellerProceeds = projectedPriceUsd * (1 - fees.sellerFeePct);
  const projectedProfitUsd =
    (event.faceMaxUsd ?? 0) > 0
      ? sellerProceeds - event.faceMaxUsd
      : null;

  // 4. Assess confidence
  const confidence = Math.min(
    1.0,
    0.3 + (recentPrices.length / 10) * 0.5 + (ownSnapshots.length > 0 ? 0.2 : 0)
  );

  return {
    projectedPriceUsd,
    projectedProfitUsd,
    confidence,
    reasoning: {
      summary: `Based on ${recentPrices.length} comparable prices. Average: $${avgComparablePrice.toFixed(2)}`,
      comparablesUsed: comparables.map((c) => c.event.id),
      adjustmentsApplied: { demand_multiplier: 1.2 },
      notes: event.isSafeTix ? "SafeTix may limit resale velocity" : undefined,
    },
  };
};
```

### Step 2: Register in `algorithms` registry

```typescript
export const algorithms = {
  placeholder_1_3x: {
    name: "placeholder_1_3x",
    version: "0.1.0",
    fn: placeholderAlgorithm,
  },
  myAlgorithm_1_0: {
    name: "myAlgorithm_1_0",
    version: "1.0.0",
    fn: myAlgorithm,
  },
};
```

### Step 3: Run projections

```bash
# Test with dry-run first
npm run projections:run -- --algorithm myAlgorithm_1_0 --dry-run

# Run for real
npm run projections:run -- --algorithm myAlgorithm_1_0

# Run for a single event
npm run projections:run -- --algorithm myAlgorithm_1_0 --event-id abc123
```

## Versioning

Always bump the version when you change an algorithm's logic:

- `0.1.0` → `0.2.0` if you change calculation significantly
- `1.0.0` → `1.0.1` if you fix a bug
- `2.0.0` if you rewrite from scratch

The database stores `algorithmVersion` with each projection, so you can:
- Compare projections from different algorithm versions
- Track accuracy improvements over time
- Revert to an older version if needed

## Command-Line Reference

```bash
npm run projections:run [options]
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--algorithm NAME` | `placeholder_1_3x` | Algorithm to use |
| `--event-id ID` | (all) | Project only one event |
| `--upcoming-only` | true | Only events with onsaleStart or eventDate >= now |
| `--dry-run` | false | Don't persist to database |

### Examples

```bash
# Run placeholder on all upcoming events (dry-run)
npm run projections:run -- --dry-run

# Run your algorithm on a specific event
npm run projections:run -- --algorithm myAlgorithm_1_0 --event-id evt123

# Run all upcoming with your algorithm
npm run projections:run -- --algorithm myAlgorithm_1_0 --upcoming-only

# Also project past events
npm run projections:run -- --algorithm myAlgorithm_1_0 --no-upcoming-only
```

## Schema Reference

### Event

```
id: string
name: string
category: "CONCERT" | "FESTIVAL"
eventDate: DateTime
onsaleStart: DateTime
faceMinUsd: number | null
faceMaxUsd: number | null
isSafeTix: boolean
isNonTransferable: boolean
resalePlatformRestriction: string | null
resalePriceCap: number | null
venue: Venue
artist: Artist | null
```

### ResaleSnapshot

```
id: string
eventId: string
source: string
capturedAt: DateTime
priceMinUsd: number | null
priceMedianUsd: number | null
priceMaxUsd: number | null
priceAvgUsd: number | null
listingCount: number | null
daysUntilEvent: number | null
```

### Projection (persisted result)

```
id: string
eventId: string
algorithmName: string
algorithmVersion: string
computedAt: DateTime
projectedPriceUsd: number
projectedProfitUsd: number | null
confidence: number | null
reasoningJson: string (JSON)
```

## Accuracy Tracking

To compare your projections against actual resale outcomes:

1. **Collect actual peak prices** from resale platforms (TickPick, StubHub, etc.)
2. **Compare against `Projection.projectedPriceUsd`** for the same `eventId` and `algorithmVersion`
3. **Calculate error metrics**: MAE, RMSE, percentage error
4. **Filter by `confidence`**: Check if higher confidence projections are more accurate
5. **Iterate**: Adjust algorithm logic and bump version

The system stores full projection history, so you can evaluate and improve over time.

## Tips

- **SafeTix events** have limited resale velocity; consider discounting projections
- **Non-transferable events** have zero resale value
- **Price caps** limit the upside (check `event.resalePriceCap`)
- **Venue capacity** is a key demand signal; smaller venues often see higher multiples
- **Time to event** matters; prices typically peak closer to the date

Good luck!
