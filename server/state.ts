// In-memory projection of the collection, rebuilt from sqlite at boot.
// Ownership is always derived from claims — never stored — so nothing has to
// run on a timer to expire anything.

import { CFG, TIER_POINTS, type Tier } from '../shared/config'
import { blend, describe, hex } from '../shared/palette'
import { isGated, parseTrivia, publicTrivia } from '../shared/trivia'
import type {
  CityColour,
  Claim,
  DashStats,
  FeedEntry,
  Landmark,
  LandmarkPin,
  LandmarkState,
  LeaderRow,
  Photo,
  Standings,
} from '../shared/types'
import { corpusStats } from './corpus'
import { allAttempts, allClaims, allLandmarks, allPhotos } from './db'

export const landmarks: Landmark[] = allLandmarks()
export const photos: Photo[] = allPhotos()
export const claims: Claim[] = allClaims()

export const byId = new Map(landmarks.map((l) => [l.id, l]))
export const photosByLandmark = new Map<string, Photo[]>()
for (const p of photos) {
  const arr = photosByLandmark.get(p.landmarkId)
  if (arr) arr.push(p)
  else photosByLandmark.set(p.landmarkId, [p])
}

export function addPhoto(p: Photo): void {
  photos.push(p)
  const arr = photosByLandmark.get(p.landmarkId)
  if (arr) arr.push(p)
  else photosByLandmark.set(p.landmarkId, [p])
  const l = byId.get(p.landmarkId)
  if (l) l.photoCount++
}

export function addClaim(c: Claim): void {
  claims.push(c)
}

export function currentOwner(landmarkId: string, now: number): Claim | null {
  let best: Claim | null = null
  for (const c of claims) {
    if (c.landmarkId !== landmarkId) continue
    if (c.expiresAt <= now) continue
    if (!best || c.claimedAt > best.claimedAt) best = c
  }
  return best
}

export function stateOf(l: Landmark, now: number): LandmarkState {
  const owner = currentOwner(l.id, now)
  const mine = photosByLandmark.get(l.id) ?? []

  // A gated place sends its question without the answer; an ungated one sends
  // the whole thing, because there the question is only flavour.
  const gated = isGated(l)
  const trivia = parseTrivia(l.funFact)
  const { funFact: _raw, ...rest } = l

  return {
    ...rest,
    owner: owner
      ? {
          handle: owner.handle,
          avatarColor: owner.avatarColor,
          expiresAt: owner.expiresAt,
          photoId: owner.photoId,
        }
      : null,
    claimCount: claims.reduce((n, c) => n + (c.landmarkId === l.id ? 1 : 0), 0),
    palette: blend(mine),
    funFact: gated ? null : l.funFact,
    trivia: gated && trivia ? publicTrivia(trivia) : null,
    gated,
  }
}

export function allStates(now: number): LandmarkState[] {
  return landmarks.map((l) => stateOf(l, now))
}

/** The map's view of one landmark — see LandmarkPin on why it is this thin. */
export function pinOf(l: Landmark, now: number): LandmarkPin {
  const owner = currentOwner(l.id, now)
  const mine = photosByLandmark.get(l.id) ?? []
  const blended = blend(mine)
  // 5 decimal places is ~1 m — finer than GPS, and it saves a byte per pin per
  // axis, which is real money across four thousand of them.
  const round5 = (n: number): number => Math.round(n * 1e5) / 1e5
  return {
    id: l.id,
    name: l.name,
    lat: round5(l.lat),
    lng: round5(l.lng),
    tier: l.tier,
    photoCount: l.photoCount,
    owner: owner
      ? { handle: owner.handle, avatarColor: owner.avatarColor, expiresAt: owner.expiresAt }
      : null,
    tint: blended[0] ?? null,
  }
}

export function allPins(now: number): LandmarkPin[] {
  return landmarks.map((l) => pinOf(l, now))
}

export function feed(limit = 20): FeedEntry[] {
  return claims
    .slice(-limit)
    .reverse()
    .map((c) => {
      const l = byId.get(c.landmarkId)
      return {
        handle: c.handle,
        avatarColor: c.avatarColor,
        landmarkName: l?.name ?? 'somewhere',
        landmarkId: c.landmarkId,
        tier: (l?.tier ?? 1) as Tier,
        photoId: c.photoId,
        at: c.claimedAt,
      }
    })
}

/** Everyone who has ever claimed anything, ranked two ways.
 *
 *  Both boards ship in full rather than truncated to a top ten, so a player
 *  outside it can still be shown their own position. One row per person who has
 *  ever played is a rounding error next to the landmark payload. */
export function standings(now: number): Standings {
  const map = new Map<string, LeaderRow & { places: Set<string> }>()

  for (const c of claims) {
    const l = byId.get(c.landmarkId)
    const pts = TIER_POINTS[(l?.tier ?? 1) as Tier]
    let row = map.get(c.handle)
    if (!row) {
      row = {
        handle: c.handle,
        avatarColor: c.avatarColor,
        holding: 0,
        allTime: 0,
        visited: 0,
        points: 0,
        places: new Set<string>(),
      }
      map.set(c.handle, row)
    }
    row.allTime++
    row.points += pts
    // Re-taking a place you already know is not visiting somewhere new.
    row.places.add(c.landmarkId)
  }

  for (const l of landmarks) {
    const o = currentOwner(l.id, now)
    if (o) {
      const row = map.get(o.handle)
      if (row) row.holding++
    }
  }

  const rows: LeaderRow[] = [...map.values()].map(({ places, ...r }) => ({
    ...r,
    visited: places.size,
  }))

  // Points break ties on both boards, so a tie is settled by what you took
  // rather than arbitrarily.
  const byHolding = [...rows].sort((a, b) => b.holding - a.holding || b.points - a.points)
  const byVisited = [...rows].sort((a, b) => b.visited - a.visited || b.points - a.points)

  return { holding: byHolding, visited: byVisited, players: rows.length }
}

/** The aggregate portrait — what the neighbourhood actually looked like today. */
export function cityColour(paintingKey: string | null): CityColour {
  if (photos.length === 0) {
    return {
      palette: [],
      brightness: 0,
      saturation: 0,
      skyFraction: 0,
      reading: 'nothing seen yet',
      photos: 0,
      byHour: [],
      extremes: { mostVivid: null, dimmest: null, openest: null },
      paintingKey,
    }
  }

  const mean = (f: (p: Photo) => number): number =>
    photos.reduce((s, p) => s + f(p), 0) / photos.length

  const brightness = mean((p) => p.brightness)
  const saturation = mean((p) => p.saturation)
  const skyFraction = mean((p) => p.skyFraction)

  const hours = new Map<number, Photo[]>()
  for (const p of photos) {
    const h = new Date(p.takenAt).getHours()
    const arr = hours.get(h)
    if (arr) arr.push(p)
    else hours.set(h, [p])
  }

  // Which places sit at the extremes — averaged per landmark, not per photo,
  // so one enthusiastic photographer cannot skew a whole location.
  const perPlace = [...photosByLandmark.entries()]
    .filter(([, ps]) => ps.length > 0)
    .map(([id, ps]) => ({
      name: byId.get(id)?.name ?? id,
      sat: ps.reduce((s, p) => s + p.saturation, 0) / ps.length,
      bri: ps.reduce((s, p) => s + p.brightness, 0) / ps.length,
      sky: ps.reduce((s, p) => s + p.skyFraction, 0) / ps.length,
    }))

  const top = (k: 'sat' | 'bri' | 'sky', dir: 1 | -1): string | null =>
    perPlace.length === 0
      ? null
      : [...perPlace].sort((a, b) => (b[k] - a[k]) * dir)[0].name

  return {
    palette: blend(photos),
    brightness,
    saturation,
    skyFraction,
    reading: describe(brightness, saturation, skyFraction),
    photos: photos.length,
    byHour: [...hours.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([hour, ps]) => ({ hour, palette: blend(ps), n: ps.length })),
    extremes: {
      mostVivid: top('sat', 1),
      dimmest: top('bri', -1),
      openest: top('sky', 1),
    },
    paintingKey,
  }
}

export function dashStats(now: number, paintingKey: string | null): DashStats {
  const attempts = allAttempts()
  const passed = attempts.filter((a) => a.passed === 1)
  const scored = attempts.filter((a) => a.confidence !== null && a.confidence > 0)

  const byTier: DashStats['confidenceByTier'] = ([1, 2, 3] as Tier[]).map((tier) => {
    const rows = scored.filter((a) => a.tier === tier)
    return {
      tier,
      mean: rows.length ? Math.round(rows.reduce((s, a) => s + (a.confidence ?? 0), 0) / rows.length) : 0,
      n: rows.length,
    }
  })

  const rejMap = new Map<string, number>()
  for (const a of attempts) {
    if (a.passed === 1 || !a.reason) continue
    rejMap.set(a.reason, (rejMap.get(a.reason) ?? 0) + 1)
  }

  const { bucketMs, maxBuckets } = CFG.timeline
  const t0 = Math.floor((now - (maxBuckets - 1) * bucketMs) / bucketMs) * bucketMs
  const counts = new Array<number>(maxBuckets).fill(0)
  for (const c of claims) {
    const i = Math.floor((c.claimedAt - t0) / bucketMs)
    if (i >= 0 && i < maxBuckets) counts[i]++
  }

  const contest = new Map<string, number>()
  for (const c of claims) contest.set(c.landmarkId, (contest.get(c.landmarkId) ?? 0) + 1)

  return {
    corpus: corpusStats(landmarks),
    totalClaims: claims.length,
    activeClaims: landmarks.filter((l) => currentOwner(l.id, now)).length,
    players: new Set(claims.map((c) => c.handle)).size,
    landmarks: landmarks.length,
    photos: photos.length,
    attempts: attempts.length,
    passRate: attempts.length ? passed.length / attempts.length : 0,
    meanConfidence: scored.length
      ? Math.round(scored.reduce((s, a) => s + (a.confidence ?? 0), 0) / scored.length)
      : 0,
    confidenceByTier: byTier,
    rejections: [...rejMap.entries()]
      .map(([reason, n]) => ({ reason, n }))
      .sort((a, b) => b.n - a.n),
    timeline: { t0, bucketMs, counts },
    mostContested: [...contest.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([landmarkId, n]) => ({ name: byId.get(landmarkId)?.name ?? landmarkId, landmarkId, n })),
    heat: landmarks
      .filter((l) => (photosByLandmark.get(l.id)?.length ?? 0) > 0)
      .map((l) => [l.lng, l.lat, photosByLandmark.get(l.id)!.length] as [number, number, number]),
    city: cityColour(paintingKey),
  }
}

export { hex }
