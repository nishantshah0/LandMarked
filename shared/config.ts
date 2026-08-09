// ── THE ONE THING TO CHANGE BEFORE JUDGING ────────────────────────────────
// Set VENUE to wherever you actually are. It is seeded as a claimable landmark
// with a generous radius so a judge can claim it standing at your table — that
// is the whole live-demo moment, so get the coordinates right.
export const VENUE = {
  name: 'SummerHacks 2026',
  lat: 43.6426,
  lng: -79.4025,
  radiusM: 250, // generous: indoors, GPS drifts badly
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
export const MAX_LANDMARKS = 30

export const CFG = {
  claimHours: 3,
  /** how close you must be to claim an ordinary landmark */
  claimRadiusM: 100,
  /** GPS in dense downtown drifts 20–50m; anything tighter rejects honest players */
  minAccuracyM: 200,
  /** hamming distance under which two photos count as the same picture */
  phashDupDistance: 8,
  maxPhotoBytes: 6_000_000,
  visionMinConfidence: 60,
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
