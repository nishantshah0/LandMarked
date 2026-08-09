import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, normalize as normPath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, WebSocket } from 'ws'
import { CFG, TIER_POINTS, VENUE } from '../shared/config'
import { dHash, hamming, haversineM } from '../shared/geo'
import { hex } from '../shared/palette'
import type {
  ClaimResponse,
  Photo,
  PhotoAnalysis,
  RejectReason,
  ServerMsg,
} from '../shared/types'
import { REJECT_TEXT } from '../shared/types'
import { closeDb, insertClaim, insertPhoto, logAttempt, photoHashesFor } from './db'
import {
  addClaim,
  addPhoto,
  allStates,
  byId,
  cityColour,
  dashStats,
  feed,
  landmarks,
  leaders,
  photos,
  photosByLandmark,
  stateOf,
} from './state'
import { verifyPhoto, visionEnabled } from './vision'

const PORT = Number(process.env.PORT || 8787)
const PHOTO_DIR = 'data/photos'

console.log(
  `[seen] ${landmarks.length} landmarks · ${photos.length} photographs · vision ${
    visionEnabled() ? 'on' : 'off (deterministic checks only)'
  }`,
)

/* ---------------- helpers ---------------- */

function json(res: ServerResponse, code: number, body: unknown): void {
  const s = JSON.stringify(body)
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) })
  res.end(s)
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        reject(new Error('too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const COLORS = ['#e5533d', '#2f7d94', '#c58a1e', '#6a5a9e', '#3f7d49', '#b4456f']
function colorFor(handle: string): string {
  let h = 0
  for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) >>> 0
  return COLORS[h % COLORS.length]
}

function sanitizeAnalysis(a: unknown): PhotoAnalysis | null {
  if (!a || typeof a !== 'object') return null
  const x = a as Record<string, unknown>
  const gray = Array.isArray(x.gray) ? x.gray.map(Number).slice(0, 72) : []
  if (gray.length !== 72 || gray.some((n) => !Number.isFinite(n))) return null
  const palette = Array.isArray(x.palette)
    ? (x.palette.slice(0, 6).map((c) =>
        Array.isArray(c) ? [Number(c[0]) || 0, Number(c[1]) || 0, Number(c[2]) || 0] : [0, 0, 0],
      ) as [number, number, number][])
    : []
  const weights = Array.isArray(x.weights) ? x.weights.slice(0, 6).map((n) => Number(n) || 0) : []
  const num = (v: unknown): number => Math.max(0, Math.min(1, Number(v) || 0))
  return {
    gray,
    palette,
    weights,
    brightness: num(x.brightness),
    saturation: num(x.saturation),
    skyFraction: num(x.skyFraction),
  }
}

/* ---------------- the claim ---------------- */

interface ClaimBody {
  landmarkId?: string
  handle?: string
  lat?: number
  lng?: number
  accuracy?: number
  photo?: string
  analysis?: unknown
}

async function handleClaim(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: ClaimBody
  try {
    body = JSON.parse(await readBody(req, CFG.maxPhotoBytes + 200_000)) as ClaimBody
  } catch {
    json(res, 413, { ok: false, reason: 'no_photo', message: 'Photo was too large' })
    return
  }

  const now = Date.now()
  const landmark = byId.get(String(body.landmarkId ?? ''))
  const handle = String(body.handle ?? '').trim().slice(0, 24)

  const fail = (reason: RejectReason, message?: string, extra: Partial<ClaimResponse> = {}): void => {
    if (landmark) {
      logAttempt({
        landmarkId: landmark.id,
        tier: landmark.tier,
        at: now,
        passed: false,
        confidence: extra.confidence ?? null,
        reason,
        distanceM: extra.distanceM ?? null,
      })
    }
    json(res, 200, { ok: false, reason, message: message ?? REJECT_TEXT[reason], ...extra })
  }

  if (!landmark) {
    json(res, 404, { ok: false, reason: 'no_photo', message: 'Unknown place' })
    return
  }
  if (!handle || handle.length < 2) return fail('bad_handle')

  const lat = Number(body.lat)
  const lng = Number(body.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return fail('bad_accuracy')

  const accuracy = Number(body.accuracy)
  if (Number.isFinite(accuracy) && accuracy > CFG.minAccuracyM) {
    return fail('bad_accuracy', `Your GPS is only accurate to ${Math.round(accuracy)}m — step outside and retry`)
  }

  // Never trust a client that says it is standing somewhere.
  const distanceM = haversineM(lat, lng, landmark.lat, landmark.lng)
  const radius = landmark.id === 'venue' ? VENUE.radiusM : CFG.claimRadiusM
  if (distanceM > radius) {
    return fail('too_far', `You're ${Math.round(distanceM)}m away — get within ${radius}m`, { distanceM })
  }

  const existing = stateOf(landmark, now).owner
  if (existing) {
    const mins = Math.ceil((existing.expiresAt - now) / 60_000)
    return fail('already_claimed', `Still held by ${existing.handle} for ${mins} more min`, { distanceM })
  }

  const dataUrl = String(body.photo ?? '')
  const b64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl
  if (b64.length < 500) return fail('no_photo', undefined, { distanceM })

  const analysis = sanitizeAnalysis(body.analysis)
  if (!analysis) return fail('no_photo', 'Photo could not be read', { distanceM })

  // Deterministic, server-side: has this exact picture been submitted here before?
  const phash = dHash(analysis.gray)
  for (const prior of photoHashesFor(landmark.id)) {
    if (hamming(phash, prior) <= CFG.phashDupDistance) {
      return fail('duplicate_photo', 'That photo has already been submitted here — take a fresh one', {
        distanceM,
      })
    }
  }

  const verdict = await verifyPhoto(b64, landmark.name, landmark.category, landmark.description)
  if (verdict.checked && (!verdict.isMatch || verdict.confidence < CFG.visionMinConfidence)) {
    return fail('vision_reject', verdict.reasoning || REJECT_TEXT.vision_reject, {
      distanceM,
      confidence: verdict.confidence,
    })
  }

  // Passed. Record the photograph first — the archive is the point.
  const before = cityColour(null)
  const photoId = 'p' + now.toString(36) + Math.floor(Math.random() * 1e6).toString(36)
  try {
    writeFileSync(join(PHOTO_DIR, photoId + '.jpg'), Buffer.from(b64, 'base64'))
  } catch (e) {
    console.warn('[seen] could not write photo:', (e as Error).message)
  }

  const avatarColor = colorFor(handle)
  const photo: Photo = {
    id: photoId,
    landmarkId: landmark.id,
    handle,
    avatarColor,
    takenAt: now,
    palette: analysis.palette,
    weights: analysis.weights,
    brightness: analysis.brightness,
    saturation: analysis.saturation,
    skyFraction: analysis.skyFraction,
  }
  insertPhoto(photo, phash)
  addPhoto(photo)

  const claim = {
    id: 'c' + now.toString(36) + Math.floor(Math.random() * 1e6).toString(36),
    landmarkId: landmark.id,
    handle,
    avatarColor,
    claimedAt: now,
    expiresAt: now + CFG.claimHours * 3_600_000,
    photoId,
    confidence: verdict.confidence,
    distanceM,
  }
  insertClaim(claim)
  addClaim(claim)
  logAttempt({
    landmarkId: landmark.id,
    tier: landmark.tier,
    at: now,
    passed: true,
    confidence: verdict.checked ? verdict.confidence : null,
    reason: null,
    distanceM,
  })

  // How this one photograph moved the neighbourhood's colour.
  const after = cityColour(null)
  const dB = after.brightness - before.brightness
  const shifted =
    before.photos === 0
      ? 'Yours is the first photograph here. The neighbourhood now has a colour.'
      : `You moved the neighbourhood ${Math.abs(dB) < 0.005 ? 'barely at all' : dB > 0 ? 'brighter' : 'darker'}` +
        `${after.palette[0] ? ` — it is now ${hex(after.palette[0])}` : ''}.`

  const state = stateOf(landmark, now)
  json(res, 200, {
    ok: true,
    landmark: state,
    confidence: verdict.confidence,
    distanceM,
    points: TIER_POINTS[landmark.tier],
    shifted,
  } satisfies ClaimResponse)

  broadcast({
    t: 'claimed',
    landmark: state,
    entry: {
      handle,
      avatarColor,
      landmarkName: landmark.name,
      landmarkId: landmark.id,
      tier: landmark.tier,
      photoId,
      at: now,
    },
  })
}

/* ---------------- http ---------------- */

const DIST = fileURLToPath(new URL('../web-dist', import.meta.url))
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
}

const server = createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0]
  const now = Date.now()

  if (url === '/healthz') {
    res.writeHead(200)
    res.end('ok')
    return
  }

  if (url === '/api/claim' && req.method === 'POST') {
    void handleClaim(req, res).catch((e) => {
      console.error('[seen] claim failed:', e)
      json(res, 500, { ok: false, reason: 'no_photo', message: 'Something broke — try again' })
    })
    return
  }

  if (url === '/api/state') {
    json(res, 200, {
      landmarks: allStates(now),
      feed: feed(),
      leaders: leaders(now),
      stats: dashStats(now, null),
      now,
    })
    return
  }

  if (url.startsWith('/api/landmark/')) {
    const id = decodeURIComponent(url.slice('/api/landmark/'.length))
    const l = byId.get(id)
    if (!l) {
      json(res, 404, { error: 'unknown place' })
      return
    }
    json(res, 200, {
      landmark: stateOf(l, now),
      photos: (photosByLandmark.get(id) ?? []).slice().reverse(),
    })
    return
  }

  if (url.startsWith('/photos/')) {
    const name = url.slice('/photos/'.length).replace(/[^a-z0-9.]/gi, '')
    const file = join(PHOTO_DIR, name)
    if (existsSync(file) && statSync(file).isFile()) {
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000' })
      res.end(readFileSync(file))
    } else {
      res.writeHead(404)
      res.end('not found')
    }
    return
  }

  if (!existsSync(DIST)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('SEEN — server running. Run `npm run build` to serve the map.')
    return
  }

  let path = url
  if (path === '/') path = '/index.html'
  if (path === '/dashboard') path = '/dashboard.html'
  const file = normPath(join(DIST, path))
  if (!file.startsWith(normPath(DIST)) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
})

/* ---------------- websocket ---------------- */

const wss = new WebSocketServer({ server, path: '/ws' })

function broadcast(msg: ServerMsg): void {
  const s = JSON.stringify(msg)
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(s)
}

wss.on('connection', (ws) => {
  const now = Date.now()
  ws.send(
    JSON.stringify({
      t: 'init',
      landmarks: allStates(now),
      feed: feed(),
      leaders: leaders(now),
      stats: dashStats(now, null),
      now,
    } satisfies ServerMsg),
  )
})

setInterval(() => {
  const now = Date.now()
  broadcast({ t: 'tick', leaders: leaders(now), stats: dashStats(now, null), now })
}, CFG.broadcastMs)

process.on('uncaughtException', (e) => console.error('[seen] uncaught:', e))
process.on('unhandledRejection', (e) => console.error('[seen] unhandled rejection:', e))

function shutdown(): void {
  try {
    closeDb()
  } catch {
    // best effort
  }
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

server.listen(PORT, () => console.log(`[seen] listening on :${PORT}`))
