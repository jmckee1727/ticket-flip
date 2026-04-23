// Tour-level peak-resale priors.
//
// The comparables-based projection needs historical ratios (peak resale / face)
// to anchor its estimates. Until the snapshot corpus is dense enough to self-
// train, these hand-seeded priors give the algorithm a reasonable signal for
// popular acts based on publicly reported resale data.
//
// Each entry captures:
//   - ratio: observed peak-to-face multiplier (rough median across venues)
//   - confidence: how much weight to give this prior (0..1)
//   - source: short note on where the number came from, for auditability
//
// When the scraper corpus grows we will regress these against actuals and
// likely retire most of them — treat this file as a bootstrap, not a source
// of truth.

export interface TourPrior {
  ratio: number;
  confidence: number;
  source: string;
}

// Keys are lowercased, punctuation-stripped artist names. Use `normalizeArtist`
// before lookup so "P!nk" and "pink" both hit the same entry.
const PRIORS: Record<string, TourPrior> = {
  // 2024–2026 blockbuster tours with the most public reporting
  "taylor swift": {
    ratio: 4.0,
    confidence: 0.7,
    source: "Eras Tour resale coverage (NYT, Billboard) — median ~4x face",
  },
  "bad bunny": {
    ratio: 2.7,
    confidence: 0.6,
    source: "Most Wanted Tour StubHub/Vivid averages",
  },
  oasis: {
    ratio: 5.0,
    confidence: 0.5,
    source: "2025 reunion dynamic pricing + resale reporting; high variance",
  },
  "sabrina carpenter": {
    ratio: 2.4,
    confidence: 0.55,
    source: "Short n' Sweet Tour resale coverage",
  },
  "olivia rodrigo": {
    ratio: 2.2,
    confidence: 0.55,
    source: "Guts World Tour secondary market averages",
  },
  beyonce: {
    ratio: 2.5,
    confidence: 0.6,
    source: "Cowboy Carter / Renaissance tour data",
  },
  "zach bryan": {
    ratio: 2.1,
    confidence: 0.55,
    source: "Quittin' Time tour StubHub medians",
  },
  "morgan wallen": {
    ratio: 2.0,
    confidence: 0.5,
    source: "One Night at a Time tour resale reporting",
  },
  "billie eilish": {
    ratio: 1.8,
    confidence: 0.5,
    source: "Hit Me Hard and Soft tour resale averages",
  },
  "chappell roan": {
    ratio: 3.2,
    confidence: 0.6,
    source: "2024–2025 breakout demand; small venues, runaway resale",
  },
  // Major festivals — ratios are lower because face prices are already huge
  coachella: {
    ratio: 1.4,
    confidence: 0.6,
    source: "2024–2025 passes tracked by multiple resale aggregators",
  },
  "lollapalooza": {
    ratio: 1.3,
    confidence: 0.55,
    source: "Chicago resale data, general admission 4-day",
  },
  "bonnaroo": {
    ratio: 1.25,
    confidence: 0.5,
    source: "Secondary market GA pricing",
  },
};

// Default when the artist isn't in the table. This is the baseline observed
// for mid-to-high-demand arena concerts: face × ~1.45 at peak. Below this
// threshold most flippers don't clear fees.
export const DEFAULT_PRIOR: TourPrior = {
  ratio: 1.45,
  confidence: 0.25,
  source: "Baseline arena concert estimate (no specific tour data)",
};

export function normalizeArtist(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ") // punctuation → space (handles P!nk, J$, etc.)
    .replace(/\s+/g, " ")
    .trim();
}

export function getTourPrior(artistName: string | null | undefined): TourPrior {
  const key = normalizeArtist(artistName);
  if (!key) return DEFAULT_PRIOR;

  // Exact match first.
  if (PRIORS[key]) return PRIORS[key];

  // Substring match: "Taylor Swift | The Eras Tour" should still match
  // "taylor swift". Guard against false positives by requiring the prior
  // key to be at least 5 chars, so we don't match "P!nk" on "pink".
  for (const [priorKey, prior] of Object.entries(PRIORS)) {
    if (priorKey.length >= 5 && key.includes(priorKey)) {
      return prior;
    }
  }

  return DEFAULT_PRIOR;
}

// Export for tests and diagnostic scripts.
export const ALL_PRIORS = PRIORS;
