import './env' // must stay first — see server/env.ts
import './specimen' // must run before ./state loads the db (no-op unless SEEN_SPECIMEN=1)
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, normalize as normPath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, WebSocket } from 'ws'
import { CFG, TIER_POINTS, VENUE, VENUE_TRIVIA } from '../shared/config'
import { dHash, hamming, haversineM } from '../shared/geo'
// (route proxy uses haversineM for its fallback)
import { hex } from '../shared/palette'
import { isGated, parseTrivia } from '../shared/trivia'
import type {
  ClaimResponse,
  Photo,
  PhotoAnalysis,
  RejectReason,
  ServerMsg,
  SplatResponse,
} from '../shared/types'
import { REJECT_TEXT } from '../shared/types'
import {
  closeDb,
  DATA_DIR,
  insertClaim,
  insertPhoto,
  logAttempt,
  photoHashesFor,
  setFunFact,
  setSplat,
} from './db'
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
import {
  SPLAT_DIR,
  bundlePhotos,
  generateSplat,
  providerConfigured,
  registerSplat,
} from './splatgen'
import { verifyPhoto, visionEnabled } from './vision'

// The venue's gate is load-bearing for the live demo, and a database seeded
// before the gate existed has no question on it. Backfill it here rather than
// requiring a reseed, so an existing deploy upgrades by restarting.
const venueLandmark = byId.get('venue')
if (venueLandmark && !venueLandmark.funFact) {
  venueLandmark.funFact = JSON.stringify(VENUE_TRIVIA)
  setFunFact('venue', venueLandmark.funFact)
  console.log('[seen] backfilled the venue question — it is trivia-gated again')
}

const PORT = Number(process.env.PORT || 8787)
const PHOTO_DIR = join(DATA_DIR, 'photos')

// SPECIMEN MODE: a separate, self-labeling instance for showing the populated
// vision. Every page gets a banner injected server-side and synthetic photos
// render as palette cards stamped SPECIMEN — it cannot pass as real usage,
// by construction. The real instance never runs with this flag.
const SPECIMEN = process.env.SEEN_SPECIMEN === '1'

console.log(
  `[seen] ${landmarks.length} landmarks · ${photos.length} photographs · vision ${
    visionEnabled() ? 'on' : 'off (deterministic checks only)'
  } · 3D generator ${providerConfigured() ? 'configured' : 'manual (npm run splat)'}`,
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
  /** index into the landmark's question — required on trivia-gated places */
  triviaAnswer?: number
}

async function handleClaim(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (SPECIMEN) {
    json(res, 403, {
      ok: false,
      reason: 'no_photo',
      message: 'This is the specimen instance — claims happen on the real site',
    })
    return
  }
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

  // Iconic places are gated: answer the question or the claim does not stand.
  // Checked here, on the server, against an answer the client was never sent —
  // and before the vision call, so a wrong answer costs nothing.
  if (isGated(landmark)) {
    const trivia = parseTrivia(landmark.funFact)
    if (trivia && Number(body.triviaAnswer) !== trivia.correctIndex) {
      return fail(
        'trivia_failed',
        `"${landmark.name}" is iconic — you have to know it to take it. That was not the right answer.`,
        { distanceM },
      )
    }
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
    beforePalette: before.palette,
    afterPalette: after.palette,
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

  // Thin proxy to OSRM's public router, with a straight-line fallback so the
  // "walk me there" flow degrades instead of breaking when the shared community
  // server is slow. (§3.10 of the plan)
  if (url === '/api/route') {
    const q = new URLSearchParams((req.url ?? '').split('?')[1] ?? '')
    const fromLat = Number(q.get('fromLat'))
    const fromLng = Number(q.get('fromLng'))
    const to = byId.get(q.get('to') ?? '')
    if (!to || !Number.isFinite(fromLat) || !Number.isFinite(fromLng)) {
      json(res, 400, { error: 'bad params' })
      return
    }
    const fallback = (): void => {
      const d = haversineM(fromLat, fromLng, to.lat, to.lng)
      json(res, 200, {
        fallback: true,
        distance_m: Math.round(d),
        duration_s: Math.round(d / 1.35), // average walking speed
        geometry: {
          type: 'LineString',
          coordinates: [
            [fromLng, fromLat],
            [to.lng, to.lat],
          ],
        },
      })
    }
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 6000)
    fetch(
      `https://router.project-osrm.org/route/v1/foot/${fromLng},${fromLat};${to.lng},${to.lat}?overview=full&geometries=geojson`,
      { signal: ctrl.signal, headers: { 'user-agent': 'SEEN/1.0 (hackathon)' } },
    )
      .then(async (r) => {
        clearTimeout(t)
        if (!r.ok) return fallback()
        const body = (await r.json()) as {
          routes?: { geometry: unknown; distance: number; duration: number }[]
        }
        const route = body.routes?.[0]
        if (!route) return fallback()
        json(res, 200, {
          fallback: false,
          distance_m: Math.round(route.distance),
          duration_s: Math.round(route.duration),
          geometry: route.geometry,
        })
      })
      .catch(() => {
        clearTimeout(t)
        fallback()
      })
    return
  }

  // Grade an answer without ever revealing the right one, so the gate can give
  // instant feedback before the camera opens. The claim endpoint re-checks
  // independently — this is a convenience, never the thing being trusted.
  if (url.startsWith('/api/landmark/') && url.endsWith('/trivia') && req.method === 'POST') {
    const id = decodeURIComponent(url.slice('/api/landmark/'.length, -'/trivia'.length))
    const l = byId.get(id)
    if (!l) {
      json(res, 404, { error: 'unknown place' })
      return
    }
    void readBody(req, 4_000)
      .then((raw) => {
        const { answer } = JSON.parse(raw) as { answer?: number }
        const trivia = parseTrivia(l.funFact)
        const correct = !isGated(l) || (trivia !== null && Number(answer) === trivia.correctIndex)
        json(res, 200, { correct })
      })
      .catch(() => json(res, 400, { error: 'bad body' }))
    return
  }

  // The reconstruction input: every photograph of one place, as one zip.
  // This is the honest "crowd photos become a 3D model" pipeline — download it
  // and it goes straight into any photogrammetry tool.
  if (url.startsWith('/api/landmark/') && url.endsWith('/photos.zip')) {
    const id = decodeURIComponent(url.slice('/api/landmark/'.length, -'/photos.zip'.length))
    const l = byId.get(id)
    if (!l) {
      json(res, 404, { error: 'unknown place' })
      return
    }
    const shots = photosByLandmark.get(id) ?? []
    if (shots.length === 0) {
      json(res, 404, { error: 'no photographs here yet' })
      return
    }
    const zip = bundlePhotos(shots)
    res.writeHead(200, {
      'content-type': 'application/zip',
      'content-length': zip.length,
      'content-disposition': `attachment; filename="${id.replace(/[^a-z0-9]/gi, '')}-photos.zip"`,
    })
    res.end(zip)
    return
  }

  // Kick off reconstruction. Returns immediately — the model takes minutes, so
  // completion arrives over the socket instead of on this response.
  if (url.startsWith('/api/landmark/') && url.endsWith('/generate-splat') && req.method === 'POST') {
    const id = decodeURIComponent(url.slice('/api/landmark/'.length, -'/generate-splat'.length))
    const l = byId.get(id)
    if (!l) {
      json(res, 404, { error: 'unknown place' })
      return
    }
    const shots = photosByLandmark.get(id) ?? []
    const reply = (ok: boolean, state: typeof l.splatState, message: string): void =>
      json(res, 200, { ok, state, splatUrl: l.splatUrl, message } satisfies SplatResponse)

    if (l.splatState === 'pending') return reply(true, 'pending', 'Already reconstructing — hang on.')
    if (shots.length < CFG.splatMinPhotos) {
      return reply(
        false,
        l.splatState,
        `Needs ${CFG.splatMinPhotos - shots.length} more photograph${
          CFG.splatMinPhotos - shots.length === 1 ? '' : 's'
        } from different angles before this can be solved.`,
      )
    }
    if (!providerConfigured()) {
      return reply(
        false,
        l.splatState,
        'No generator is configured. Download the photo bundle, run it through Luma / Polycam / Postshot, then register the result.',
      )
    }

    l.splatState = 'pending'
    setSplat(l.id, 'pending', l.splatUrl, shots.length)
    reply(true, 'pending', `Reconstructing ${l.name} from ${shots.length} photographs…`)
    broadcast({ t: 'splat', landmarkId: l.id, landmarkName: l.name, state: 'pending', splatUrl: null })

    void generateSplat(l, shots, (state, splatUrl) => {
      l.splatState = state
      l.splatUrl = splatUrl
      l.splatPhotos = shots.length
      broadcast({ t: 'splat', landmarkId: l.id, landmarkName: l.name, state, splatUrl })
    })
    return
  }

  // Register a model built elsewhere. Token-guarded so it can be done from a
  // phone mid-event; without ADMIN_TOKEN set it is simply off.
  if (url.startsWith('/api/landmark/') && url.endsWith('/splat') && req.method === 'POST') {
    const id = decodeURIComponent(url.slice('/api/landmark/'.length, -'/splat'.length))
    const l = byId.get(id)
    const token = process.env.ADMIN_TOKEN ?? ''
    if (!token || req.headers['x-admin-token'] !== token) {
      json(res, 403, { error: 'ADMIN_TOKEN not set, or wrong token' })
      return
    }
    if (!l) {
      json(res, 404, { error: 'unknown place' })
      return
    }
    void readBody(req, 8_000)
      .then(async (raw) => {
        const { url: modelUrl } = JSON.parse(raw) as { url?: string }
        if (!modelUrl) {
          json(res, 400, { error: 'body needs {"url": "https://..."}' })
          return
        }
        // Remote URLs only. registerSplat also accepts a filesystem path — that
        // is the CLI's job, where the caller already has a shell. Allowing it
        // here would let a token-holder copy any local file into a publicly
        // served directory, which is not a power this endpoint needs.
        if (!/^https?:\/\//i.test(modelUrl)) {
          json(res, 400, {
            error: 'url must be http(s) — to register a local file use: npm run splat -- <id> <path>',
          })
          return
        }
        const shots = photosByLandmark.get(id) ?? []
        const out = await registerSplat(id, modelUrl, shots.length)
        if (out.ok) {
          l.splatState = 'ready'
          l.splatUrl = out.url
          l.splatPhotos = shots.length
          broadcast({
            t: 'splat',
            landmarkId: l.id,
            landmarkName: l.name,
            state: 'ready',
            splatUrl: out.url,
          })
        }
        json(res, out.ok ? 200 : 400, {
          ok: out.ok,
          state: out.ok ? 'ready' : l.splatState,
          splatUrl: out.url,
          message: out.message,
        } satisfies SplatResponse)
      })
      .catch(() => json(res, 400, { error: 'bad body' }))
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
    // Specimen "photos" are palette cards stamped SPECIMEN — self-disclosing.
    if (SPECIMEN && name.startsWith('spec')) {
      const id = name.replace(/\.jpg$/, '')
      const p = photos.find((x) => x.id === id)
      const pal = p && p.palette.length ? p.palette : [[140, 140, 140] as [number, number, number]]
      const stripes = pal
        .map(
          (c, i) =>
            `<rect x="0" y="${(i * 400) / pal.length}" width="400" height="${400 / pal.length + 1}" fill="rgb(${c
              .map(Math.round)
              .join(',')})"/>`,
        )
        .join('')
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">${stripes}` +
        `<rect x="0" y="168" width="400" height="64" fill="rgba(20,20,20,0.72)"/>` +
        `<text x="200" y="210" text-anchor="middle" font-family="system-ui,sans-serif" font-size="42" font-weight="700" letter-spacing="8" fill="#ffd76a">SPECIMEN</text></svg>`
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' })
      res.end(svg)
      return
    }
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

  // Finished 3D models. Same sanitising as photos — the name is scrubbed to
  // [a-z0-9.] before it is ever joined onto a path.
  if (url.startsWith('/splats/')) {
    const name = url.slice('/splats/'.length).replace(/[^a-z0-9.]/gi, '')
    const file = join(SPLAT_DIR, name)
    if (existsSync(file) && statSync(file).isFile()) {
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'cache-control': 'public, max-age=31536000',
      })
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
  if (path === '/splat') path = '/splat.html'
  const file = normPath(join(DIST, path))
  if (!file.startsWith(normPath(DIST)) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  if (SPECIMEN && extname(file) === '.html') {
    // Banner baked into every page render — the instance labels itself.
    const banner =
      `<div style="position:fixed;left:0;right:0;bottom:0;z-index:2147483647;text-align:center;` +
      `background:repeating-linear-gradient(45deg,#ffd76a 0 14px,#141414 14px 28px);padding:5px">` +
      `<span style="display:inline-block;background:#141414;color:#ffd76a;font:700 12px/1.6 system-ui,sans-serif;` +
      `letter-spacing:.1em;padding:5px 16px;border-radius:999px">SPECIMEN MODE — ILLUSTRATIVE DATA, NOT REAL USAGE</span></div>`
    const html = readFileSync(file, 'utf8').replace('</body>', banner + '</body>')
    res.writeHead(200, { 'content-type': MIME['.html'] })
    res.end(html)
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
