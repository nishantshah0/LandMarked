// ── THE ONE THING TO CHANGE BEFORE JUDGING ────────────────────────────────
// Set VENUE to wherever you actually are. It is seeded as a claimable landmark
// with a generous radius so a judge can claim it standing at your table — that
// is the whole live-demo moment, so get the coordinates right.
export const VENUE = {
  name: 'SummerHacks @ Stackt Market',
  // 28 Bathurst St, Toronto — Bathurst & Front
  lat: 43.641,
  lng: -79.4022,
  // Judging happens in an indoor room: no sky view, so fixes drift badly and
  // can land hundreds of metres off. Wide on purpose — this pin exists to be
  // claimable from inside the building.
  radiusM: 600,
}

/** Tight bbox around the venue. One neighbourhood, never the whole GTA —
 *  thirty claims across a city reads as abandoned; across a few blocks it
 *  reads as a scene. */
export const BBOX = {
  south: VENUE.lat - 0.018,
  west: VENUE.lng - 0.024,
  north: VENUE.lat + 0.018,
  east: VENUE.lng + 0.024,
}

/** Nearest N landmarks to the venue. Small on purpose — see the note on BBOX. */
export const MAX_LANDMARKS = 40

export const CFG = {
  claimHours: 3,
  /** how close you must be to claim an ordinary landmark */
  claimRadiusM: 100,
  /** Indoors a phone reports 100–500m accuracy; rejecting that rejects honest players */
  minAccuracyM: 600,
  /** hamming distance under which two photos count as the same picture */
  phashDupDistance: 8,
  maxPhotoBytes: 6_000_000,
  /** This is a game, not a security system — a false rejection is worse than a
   *  false accept, and the deterministic checks do the real work. */
  visionMinConfidence: 45,
  broadcastMs: 2_000,
  timeline: { bucketMs: 15 * 60_000, maxBuckets: 32 },
} as const

export type Tier = 1 | 2 | 3

export const TIER_POINTS: Record<Tier, number> = { 1: 10, 2: 25, 3: 60 }

export const TIER_LABEL: Record<Tier, string> = {
  1: 'Standard',
  2: 'Landmark',
  3: 'Iconic',
}

/** Name fragments promoted to tier 2/3 at seed time. */
export const ICONIC = ['cn tower']
export const MAJOR = [
  'casa loma',
  'nathan phillips',
  'rogers centre',
  'royal ontario museum',
  'art gallery of ontario',
  'distillery',
  'st lawrence market',
  'union station',
  'ripley',
  'ontario science centre',
  'high park',
  'kensington',
  'stackt',
  'city hall',
]
