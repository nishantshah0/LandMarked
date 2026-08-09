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
  photoCount: number
  /** JSON {question, options, correctIndex} — batch-generated flavor, or null */
  funFact: string | null
  /** embed URL of a real 3D reconstruction built from photos of this place */
  splatUrl: string | null
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

/** A landmark plus live ownership, which is derived from claims, never stored. */
export interface LandmarkState extends Landmark {
  owner: { handle: string; avatarColor: string; expiresAt: number; photoId: string } | null
  claimCount: number
  /** the place's own colour, blended from every photo ever taken there */
  palette: [number, number, number][]
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
  holding: number
  allTime: number
  points: number
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

export interface DashStats {
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

export const REJECT_TEXT: Record<RejectReason, string> = {
  too_far: 'Too far away',
  bad_accuracy: 'GPS not accurate enough',
  already_claimed: 'Still held by someone else',
  duplicate_photo: 'That photo has been submitted here before',
  vision_reject: "Photo doesn't look like this place",
  no_photo: 'No photo received',
  bad_handle: 'Pick a handle first',
}

export type ClientMsg = { t: 'hello'; handle: string | null }

export type ServerMsg =
  | {
      t: 'init'
      landmarks: LandmarkState[]
      feed: FeedEntry[]
      leaders: LeaderRow[]
      stats: DashStats
      now: number
    }
  | { t: 'claimed'; landmark: LandmarkState; entry: FeedEntry }
  | { t: 'tick'; leaders: LeaderRow[]; stats: DashStats; now: number }

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
