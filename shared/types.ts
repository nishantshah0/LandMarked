import type { Tier } from './config'
import type { PhotoAnalysis } from './palette'

export interface Landmark {
  id: string
  name: string
  lat: number
  lng: number
  tier: Tier
  category: string
  description: string | null
  /** Selected OSM tags kept verbatim (JSON object) — the factual grounding a
   *  question is generated from, so nothing has to be invented. */
  osmFacts: string | null
  photoCount: number
  /** JSON {question, options, correctIndex} — batch-generated, or null */
  funFact: string | null
}

/** The half of a question a gated client is allowed to see. */
export interface TriviaPublic {
  question: string
  options: string[]
}

/** A photograph, kept forever. Claims rotate; the archive only grows. */
export interface Photo {
  id: string
  landmarkId: string
  handle: string
  avatarColor: string
  takenAt: number
  palette: [number, number, number][]
  weights: number[]
  brightness: number
  saturation: number
  skyFraction: number
}

export interface Claim {
  id: string
  landmarkId: string
  handle: string
  avatarColor: string
  claimedAt: number
  expiresAt: number
  photoId: string
  confidence: number
  distanceM: number
}

/** A landmark plus live ownership, which is derived from claims, never stored.
 *
 *  `funFact` is deliberately dropped and re-added: on a trivia-gated landmark
 *  the raw JSON carries `correctIndex`, and shipping the answer to the client
 *  that has to prove it knows the answer would make the gate decorative. Gated
 *  places send `trivia` (question + options only) and the server marks it. */
export interface LandmarkState extends Omit<Landmark, 'funFact'> {
  owner: { handle: string; avatarColor: string; expiresAt: number; photoId: string } | null
  claimCount: number
  /** the place's own colour, blended from every photo ever taken there */
  palette: [number, number, number][]
  /** full question JSON — ungated places only, where it is pure flavour */
  funFact: string | null
  /** answer-free question — gated places only */
  trivia: TriviaPublic | null
  /** whether the camera is locked behind that question */
  gated: boolean
}

/** What one pin needs to be drawn, and nothing else.
 *
 *  City-wide, the full LandmarkState is far too heavy to send 4000 of: most of
 *  its weight is detail only a opened sheet reads (description, palette, the
 *  question, the grounding tags), and the archive blob alone was a quarter of a
 *  megabyte. Sheets fetch /api/landmark/:id, so the map never needs any of it. */
export interface LandmarkPin {
  id: string
  name: string
  lat: number
  lng: number
  tier: Tier
  photoCount: number
  owner: { handle: string; avatarColor: string; expiresAt: number } | null
  /** dominant colour of this place's archive, for the pin tint */
  tint: [number, number, number] | null
}

export interface FeedEntry {
  handle: string
  avatarColor: string
  landmarkName: string
  landmarkId: string
  tier: Tier
  photoId: string
  at: number
}

export interface LeaderRow {
  handle: string
  avatarColor: string
  /** places held right now */
  holding: number
  /** every claim ever made, re-claims of the same place included */
  allTime: number
  /** distinct places ever claimed — "visited" means somewhere new */
  visited: number
  points: number
}

/** Two boards, because they reward opposite things: holding is a snapshot you
 *  can lose while you sleep, visiting is a total nobody can take off you. */
export interface Standings {
  /** ranked by places held right now */
  holding: LeaderRow[]
  /** ranked by distinct places ever claimed */
  visited: LeaderRow[]
  /** how many people have ever claimed anything */
  players: number
}

/** The aggregate portrait: what the neighbourhood looked like, measured. */
export interface CityColour {
  palette: [number, number, number][]
  brightness: number
  saturation: number
  skyFraction: number
  reading: string
  photos: number
  /** palette per hour bucket, so you can watch the day turn */
  byHour: { hour: number; palette: [number, number, number][]; n: number }[]
  /** the most and least colourful places */
  extremes: { mostVivid: string | null; dimmest: string | null; openest: string | null }
  /** cache key of the Reve-painted portrait, when one exists */
  paintingKey: string | null
}

/** What the neighbourhood is made of, measured from the OpenStreetMap corpus.
 *  Real from the first second — it needs no photographs. */
export interface CorpusStats {
  total: number
  byCategory: { category: string; count: number }[]
  byTier: { tier: number; count: number }[]
  /** which OSM tags supply real grounding, and how often */
  grounding: { tag: string; count: number }[]
  /** share of places that say anything specific about themselves, 0..1 */
  groundedShare: number
  withWikipedia: number
  oldest: { name: string; year: number } | null
  walkBands: { label: string; count: number }[]
  medianSpacingM: number
  questionsWritten: number
  questionsPlaceScoped: number
}

/** A place gathering momentum: claims scored by recency, half-life 90 min. */
export interface TrendingRow {
  landmarkId: string
  name: string
  tier: number
  /** 0..1, share of the hottest place's score */
  heat: number
  /** claims in the last 3 h */
  recent: number
  lastAt: number
  tint: [number, number, number] | null
}

/** A first quest: a nearby, well-documented place nobody has photographed. */
export interface StartHereRow {
  landmarkId: string
  name: string
  category: string
  distanceM: number
  hasWiki: boolean
  /** how many real facts its OSM record carries */
  facts: number
}

export interface TodayRow {
  handle: string
  avatarColor: string
  n: number
}

export interface DashStats {
  corpus: CorpusStats
  /** live sockets connected right now — people looking at the neighbourhood */
  presence: number
  trending: TrendingRow[]
  startHere: StartHereRow[]
  today: TodayRow[]
  totalClaims: number
  activeClaims: number
  players: number
  landmarks: number
  photos: number
  attempts: number
  passRate: number
  meanConfidence: number
  confidenceByTier: { tier: Tier; mean: number; n: number }[]
  rejections: { reason: string; n: number }[]
  timeline: { t0: number; bucketMs: number; counts: number[] }
  mostContested: { name: string; landmarkId: string; n: number }[]
  heat: [number, number, number][]
  city: CityColour
}

export type RejectReason =
  | 'too_far'
  | 'bad_accuracy'
  | 'already_claimed'
  | 'duplicate_photo'
  | 'vision_reject'
  | 'no_photo'
  | 'bad_handle'
  | 'trivia_failed'

export const REJECT_TEXT: Record<RejectReason, string> = {
  too_far: 'Too far away',
  bad_accuracy: 'GPS not accurate enough',
  already_claimed: 'Still held by someone else',
  duplicate_photo: 'That photo has been submitted here before',
  vision_reject: "Photo doesn't look like this place",
  no_photo: 'No photo received',
  bad_handle: 'Pick a handle first',
  trivia_failed: 'Wrong answer on an iconic place',
}

export type ServerMsg =
  | {
      t: 'init'
      landmarks: LandmarkPin[]
      feed: FeedEntry[]
      standings: Standings
      stats: DashStats
      now: number
    }
  | { t: 'claimed'; landmark: LandmarkPin; entry: FeedEntry }
  | { t: 'tick'; standings: Standings; stats: DashStats; now: number }

export interface ClaimResponse {
  ok: boolean
  reason?: RejectReason
  message?: string
  landmark?: LandmarkState
  confidence?: number
  distanceM?: number
  points?: number
  /** how this photo moved the neighbourhood's colour — the payoff line */
  shifted?: string
  /** the neighbourhood's palette before and after this one photograph */
  beforePalette?: [number, number, number][]
  afterPalette?: [number, number, number][]
}

export interface ArchiveResponse {
  landmark: LandmarkState
  photos: Photo[]
}


export type { PhotoAnalysis }
