// SPECIMEN MODE seeding. Runs only with SEEN_SPECIMEN=1 and only into its own
// separate data directory — never the real instance's. The point: a populated,
// self-labeling staging instance for showing what the product looks like with
// a crowd, that cannot be mistaken for (or passed off as) real usage: the
// server banners every page and renders every synthetic "photo" as a palette
// card stamped SPECIMEN.

import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { Tier } from '../shared/config'
import type { Claim, Landmark, Photo } from '../shared/types'
import {
  allLandmarks,
  allPhotos,
  insertClaim,
  insertLandmarks,
  insertPhoto,
  landmarkCount,
  logAttempt,
} from './db'

const SPECIMEN = process.env.SEEN_SPECIMEN === '1'

const HANDLES = ['spec·ada', 'spec·kai', 'spec·noor', 'spec·finn', 'spec·mia', 'spec·theo', 'spec·zed', 'spec·ivy']
const COLORS = ['#e5533d', '#2f7d94', '#c58a1e', '#6a5a9e', '#3f7d49', '#b4456f', '#7a6a29', '#2f5d8a']

// plausible city palette families: brick, sky, foliage, concrete, mural
const FAMILIES: [number, number, number][][] = [
  [[158, 74, 54], [190, 120, 90], [96, 60, 48], [220, 205, 185], [70, 70, 75]],
  [[120, 160, 200], [200, 210, 220], [90, 110, 140], [235, 230, 220], [60, 70, 85]],
  [[80, 120, 70], [140, 170, 110], [60, 80, 55], [200, 200, 185], [110, 90, 60]],
  [[150, 150, 150], [190, 190, 185], [110, 110, 115], [220, 218, 210], [80, 80, 85]],
  [[210, 90, 60], [240, 190, 60], [60, 120, 160], [90, 60, 130], [230, 225, 210]],
]

function jitter(c: [number, number, number]): [number, number, number] {
  const j = (v: number): number => Math.max(0, Math.min(255, Math.round(v + (Math.random() * 2 - 1) * 22)))
  return [j(c[0]), j(c[1]), j(c[2])]
}

function copyLandmarksFromReal(): void {
  if (!existsSync('data/seen.db')) {
    console.error('[specimen] real data/seen.db not found — run `npm run seed` for the real instance first')
    return
  }
  const real = new DatabaseSync('data/seen.db')
  const rows = real
    .prepare('SELECT id,name,lat,lng,tier,category,description FROM landmarks')
    .all() as unknown as {
    id: string
    name: string
    lat: number
    lng: number
    tier: number
    category: string
    description: string | null
  }[]
  real.close()
  const lms: Landmark[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    lat: r.lat,
    lng: r.lng,
    tier: r.tier as Tier,
    category: r.category,
    description: r.description,
    photoCount: 0,
    funFact: null,
    splatUrl: null,
  }))
  insertLandmarks(lms)
  console.log(`[specimen] copied ${lms.length} landmarks from the real instance`)
}

function seed(): void {
  if (landmarkCount() === 0) copyLandmarksFromReal()
  if (allPhotos().length > 0) return

  const lms = allLandmarks()
  if (lms.length === 0) return

  const now = Date.now()
  let pn = 0
  let claims = 0

  for (const l of lms) {
    if (l.id !== 'venue' && Math.random() < 0.3) continue // some places still untouched
    const n = l.id === 'venue' ? 4 : 1 + Math.floor(Math.random() * 3)
    for (let i = 0; i < n; i++) {
      const hoursAgo = 0.5 + Math.random() * 10
      const takenAt = Math.round(now - hoursAgo * 3_600_000)
      const fam = FAMILIES[Math.floor(Math.random() * FAMILIES.length)]
      const palette = fam.map(jitter)
      const weights = [0.34, 0.24, 0.18, 0.14, 0.1]
      const hi = Math.floor(Math.random() * HANDLES.length)
      const photo: Photo = {
        id: 'spec' + pn++,
        landmarkId: l.id,
        handle: HANDLES[hi],
        avatarColor: COLORS[hi],
        takenAt,
        palette,
        weights,
        brightness: 0.3 + Math.random() * 0.45,
        saturation: 0.12 + Math.random() * 0.4,
        skyFraction: Math.random() * 0.5,
      }
      insertPhoto(photo, 'spec' + String(pn).padStart(12, '0'))
      const claim: Claim = {
        id: 'specc' + pn,
        landmarkId: l.id,
        handle: photo.handle,
        avatarColor: photo.avatarColor,
        claimedAt: takenAt,
        expiresAt: takenAt + 3 * 3_600_000,
        photoId: photo.id,
        confidence: 62 + Math.floor(Math.random() * 35),
        distanceM: 4 + Math.random() * 80,
      }
      insertClaim(claim)
      claims++
      logAttempt({
        landmarkId: l.id,
        tier: l.tier,
        at: takenAt,
        passed: true,
        confidence: claim.confidence,
        reason: null,
        distanceM: claim.distanceM,
      })
    }
  }

  // a believable failure tail for the verification card
  const reasons = ['too_far', 'duplicate_photo', 'vision_reject', 'too_far', 'bad_accuracy'] as const
  for (const reason of reasons) {
    const l = lms[Math.floor(Math.random() * lms.length)]
    logAttempt({
      landmarkId: l.id,
      tier: l.tier,
      at: Math.round(now - Math.random() * 8 * 3_600_000),
      passed: false,
      confidence: reason === 'vision_reject' ? 20 + Math.floor(Math.random() * 30) : null,
      reason,
      distanceM: reason === 'too_far' ? 200 + Math.random() * 900 : 30,
    })
  }

  console.log(`[specimen] seeded ${pn} specimen photos / ${claims} claims across ${lms.length} places`)
}

if (SPECIMEN) seed()
