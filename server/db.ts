import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { Tier } from '../shared/config'
import type { Claim, Landmark, Photo, RejectReason, SplatState } from '../shared/types'

mkdirSync('data/photos', { recursive: true })
mkdirSync('data/splats', { recursive: true })

const DB_PATH = 'data/seen.db'
let db = new DatabaseSync(DB_PATH)

db.exec(`
  CREATE TABLE IF NOT EXISTS landmarks (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL,
    tier INTEGER NOT NULL, category TEXT NOT NULL, description TEXT, photo_count INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY, landmark_id TEXT NOT NULL, handle TEXT NOT NULL,
    avatar_color TEXT NOT NULL, taken_at INTEGER NOT NULL, phash TEXT NOT NULL,
    palette_json TEXT NOT NULL, weights_json TEXT NOT NULL,
    brightness REAL NOT NULL, saturation REAL NOT NULL, sky REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_photo_lm ON photos(landmark_id);
  CREATE TABLE IF NOT EXISTS claims (
    id TEXT PRIMARY KEY, landmark_id TEXT NOT NULL, handle TEXT NOT NULL,
    avatar_color TEXT NOT NULL, claimed_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    photo_id TEXT NOT NULL, confidence INTEGER NOT NULL, distance_m REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_claim_lm ON claims(landmark_id);
  CREATE TABLE IF NOT EXISTS attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, landmark_id TEXT NOT NULL, tier INTEGER NOT NULL,
    at INTEGER NOT NULL, passed INTEGER NOT NULL, confidence INTEGER,
    reason TEXT, distance_m REAL
  );
`)

// Columns added after first ship. Each ALTER is attempted independently and
// idempotently, so an existing database upgrades in place on boot and a fresh
// one is unaffected.
for (const col of [
  'fun_fact TEXT',
  'splat_url TEXT',
  "splat_state TEXT NOT NULL DEFAULT 'none'",
  'splat_photos INTEGER NOT NULL DEFAULT 0',
  'splat_updated_at INTEGER',
]) {
  try {
    db.exec(`ALTER TABLE landmarks ADD COLUMN ${col}`)
  } catch {
    // column already exists
  }
}

function reopen(): void {
  try {
    db.close()
  } catch {
    // already unusable
  }
  db = new DatabaseSync(DB_PATH)
  console.warn('[seen] reopened sqlite after a write failure')
}

function guard(fn: () => void): void {
  try {
    fn()
  } catch {
    reopen()
    fn()
  }
}

/* ---------------- landmarks ---------------- */

export function landmarkCount(): number {
  const r = db.prepare('SELECT COUNT(*) AS n FROM landmarks').get() as unknown as { n: number }
  return Number(r.n)
}

export function insertLandmarks(list: Landmark[]): void {
  const st = db.prepare(
    `INSERT OR REPLACE INTO landmarks (id,name,lat,lng,tier,category,description,photo_count,fun_fact)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  )
  db.exec('BEGIN')
  for (const l of list) {
    st.run(l.id, l.name, l.lat, l.lng, l.tier, l.category, l.description, l.photoCount, l.funFact)
  }
  db.exec('COMMIT')
}

interface LRow {
  id: string
  name: string
  lat: number
  lng: number
  tier: number
  category: string
  description: string | null
  photo_count: number
  fun_fact: string | null
  splat_url: string | null
  splat_state: string | null
  splat_photos: number | null
}

export function allLandmarks(): Landmark[] {
  const rows = db.prepare('SELECT * FROM landmarks').all() as unknown as LRow[]
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    lat: r.lat,
    lng: r.lng,
    tier: r.tier as Tier,
    category: r.category,
    description: r.description,
    photoCount: Number(r.photo_count),
    funFact: r.fun_fact ?? null,
    splatUrl: r.splat_url ?? null,
    splatState: (r.splat_state as SplatState | null) ?? 'none',
    splatPhotos: Number(r.splat_photos ?? 0),
  }))
}

export function setFunFact(id: string, json: string): void {
  guard(() => {
    db.prepare('UPDATE landmarks SET fun_fact = ? WHERE id = ?').run(json, id)
  })
}

/* ---------------- 3D reconstruction ---------------- */

export function setSplat(
  id: string,
  state: SplatState,
  url: string | null,
  photos: number,
): void {
  guard(() => {
    db.prepare(
      'UPDATE landmarks SET splat_state = ?, splat_url = ?, splat_photos = ?, splat_updated_at = ? WHERE id = ?',
    ).run(state, url, photos, Date.now(), id)
  })
}

/* ---------------- photos: the permanent archive ---------------- */

interface PRow {
  id: string
  landmark_id: string
  handle: string
  avatar_color: string
  taken_at: number
  phash: string
  palette_json: string
  weights_json: string
  brightness: number
  saturation: number
  sky: number
}

function hydratePhoto(r: PRow): Photo {
  return {
    id: r.id,
    landmarkId: r.landmark_id,
    handle: r.handle,
    avatarColor: r.avatar_color,
    takenAt: Number(r.taken_at),
    palette: JSON.parse(r.palette_json),
    weights: JSON.parse(r.weights_json),
    brightness: r.brightness,
    saturation: r.saturation,
    skyFraction: r.sky,
  }
}

export function allPhotos(): Photo[] {
  const rows = db
    .prepare('SELECT * FROM photos ORDER BY taken_at ASC')
    .all() as unknown as PRow[]
  return rows.map(hydratePhoto)
}

export function photoHashesFor(landmarkId: string): string[] {
  const rows = db
    .prepare('SELECT phash FROM photos WHERE landmark_id = ?')
    .all(landmarkId) as unknown as { phash: string }[]
  return rows.map((r) => r.phash)
}

export function insertPhoto(p: Photo, phash: string): void {
  guard(() => {
    db.prepare(
      `INSERT INTO photos (id,landmark_id,handle,avatar_color,taken_at,phash,
         palette_json,weights_json,brightness,saturation,sky)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      p.id,
      p.landmarkId,
      p.handle,
      p.avatarColor,
      p.takenAt,
      phash,
      JSON.stringify(p.palette),
      JSON.stringify(p.weights),
      p.brightness,
      p.saturation,
      p.skyFraction,
    )
    db.prepare('UPDATE landmarks SET photo_count = photo_count + 1 WHERE id = ?').run(p.landmarkId)
  })
}

/* ---------------- claims ---------------- */

interface CRow {
  id: string
  landmark_id: string
  handle: string
  avatar_color: string
  claimed_at: number
  expires_at: number
  photo_id: string
  confidence: number
  distance_m: number
}

export function allClaims(): Claim[] {
  const rows = db
    .prepare('SELECT * FROM claims ORDER BY claimed_at ASC')
    .all() as unknown as CRow[]
  return rows.map((r) => ({
    id: r.id,
    landmarkId: r.landmark_id,
    handle: r.handle,
    avatarColor: r.avatar_color,
    claimedAt: Number(r.claimed_at),
    expiresAt: Number(r.expires_at),
    photoId: r.photo_id,
    confidence: Number(r.confidence),
    distanceM: r.distance_m,
  }))
}

export function insertClaim(c: Claim): void {
  guard(() => {
    db.prepare(
      `INSERT INTO claims (id,landmark_id,handle,avatar_color,claimed_at,expires_at,photo_id,confidence,distance_m)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      c.id,
      c.landmarkId,
      c.handle,
      c.avatarColor,
      c.claimedAt,
      c.expiresAt,
      c.photoId,
      c.confidence,
      c.distanceM,
    )
  })
}

/* ---------------- verification telemetry ---------------- */

export interface Attempt {
  landmarkId: string
  tier: Tier
  at: number
  passed: boolean
  confidence: number | null
  reason: RejectReason | null
  distanceM: number | null
}

export function logAttempt(a: Attempt): void {
  guard(() => {
    db.prepare(
      `INSERT INTO attempts (landmark_id,tier,at,passed,confidence,reason,distance_m)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(a.landmarkId, a.tier, a.at, a.passed ? 1 : 0, a.confidence, a.reason, a.distanceM)
  })
}

export interface AttemptRow {
  tier: number
  passed: number
  confidence: number | null
  reason: string | null
}

export function allAttempts(): AttemptRow[] {
  return db
    .prepare('SELECT tier, passed, confidence, reason FROM attempts')
    .all() as unknown as AttemptRow[]
}

export function closeDb(): void {
  db.close()
}
