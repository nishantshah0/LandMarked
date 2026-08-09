import type { FeatureCollection } from 'geojson'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { TIER_LABEL, VENUE, type Tier } from '../shared/config'
import { hex } from '../shared/palette'
import type { DashStats, FeedEntry, LeaderRow, ServerMsg, Standings } from '../shared/types'
import { REJECT_TEXT } from '../shared/types'

const $ = (id: string): HTMLElement => document.getElementById(id)!

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/* ---------------- the live feed ---------------- */

/** Newest first, capped — this is a pulse, not an audit log. */
const FEED_MAX = 24
let feedRows: FeedEntry[] = []

function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

function paintFeed(): void {
  if (feedRows.length === 0) {
    $('feed').innerHTML =
      '<li class="none">Nothing claimed yet. The first photograph starts the archive.</li>'
    return
  }
  $('feed').innerHTML = feedRows
    .map(
      (e, i) =>
        `<li class="${i === 0 ? 'fresh' : ''}">` +
        `<i class="dot" style="background:${escapeHtml(e.avatarColor)}"></i>` +
        `<span class="fw"><b>${escapeHtml(e.handle)}</b> claimed ${escapeHtml(e.landmarkName)}</span>` +
        `<time datetime="${new Date(e.at).toISOString()}">${ago(e.at)}</time></li>`,
    )
    .join('')
}

function setFeed(list: FeedEntry[]): void {
  feedRows = list.slice(0, FEED_MAX)
  paintFeed()
}

function pushFeed(e: FeedEntry): void {
  feedRows = [e, ...feedRows.filter((x) => x.photoId !== e.photoId)].slice(0, FEED_MAX)
  paintFeed()
}

// Timestamps go stale on their own, so re-render the relative times even when
// nothing new arrives.
setInterval(() => {
  if (feedRows.length) paintFeed()
}, 15_000)

/* ---------------- the geographic heatmap ---------------- */

let heatMap: maplibregl.Map | null = null
let heatReady = false

function heatGeoJSON(heat: [number, number, number][]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: heat.map(([lng, lat, n]) => ({
      type: 'Feature',
      properties: { n },
      geometry: { type: 'Point', coordinates: [lng, lat] },
    })),
  }
}

function initHeatmap(): void {
  heatMap = new maplibregl.Map({
    container: 'heatmap',
    // Same near-grayscale basemap as the game, so the heat is the only colour.
    style: 'https://tiles.openfreemap.org/styles/positron',
    center: [VENUE.lng, VENUE.lat],
    zoom: 11,
    attributionControl: { compact: true },
  })
  heatMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

  heatMap.on('load', () => {
    heatMap!.addSource('heat', { type: 'geojson', data: heatGeoJSON([]) })
    heatMap!.addLayer({
      id: 'heat',
      type: 'heatmap',
      source: 'heat',
      paint: {
        // Weight by photographs held, so a much-visited place burns brighter.
        'heatmap-weight': ['interpolate', ['linear'], ['get', 'n'], 0, 0.25, 12, 1],
        'heatmap-intensity': 1.1,
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 9, 18, 16, 46],
        'heatmap-opacity': 0.85,
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0, 'rgba(0,0,0,0)',
          0.2, 'rgba(47,125,148,0.55)',
          0.45, 'rgba(197,138,30,0.75)',
          0.75, 'rgba(229,83,61,0.9)',
          1, 'rgb(229,83,61)',
        ],
      },
    })
    // A single claim should still be visible once you zoom past the blur.
    heatMap!.addLayer({
      id: 'heat-points',
      type: 'circle',
      source: 'heat',
      minzoom: 13,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'n'], 1, 4, 12, 11],
        'circle-color': '#e5533d',
        'circle-opacity': 0.75,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#f7f5ef',
      },
    })
    heatReady = true
    if (lastHeat) applyHeat(lastHeat)
  })
}

let lastHeat: [number, number, number][] | null = null

function applyHeat(heat: [number, number, number][]): void {
  lastHeat = heat
  $('heatEmpty').toggleAttribute('hidden', heat.length > 0)
  if (!heatReady || !heatMap) return
  const src = heatMap.getSource('heat') as maplibregl.GeoJSONSource | undefined
  src?.setData(heatGeoJSON(heat))
}

function setLive(on: boolean): void {
  $('live').classList.toggle('on', on)
  $('liveLabel').textContent = on ? 'live' : 'reconnecting'
}

function beat(): void {
  const el = $('live')
  el.classList.remove('beat')
  void el.offsetWidth
  el.classList.add('beat')
}

function countUp(el: HTMLElement, to: number): void {
  const from = Number(el.dataset.v ?? '0')
  el.dataset.v = String(to)
  if (from === to) {
    el.textContent = to.toLocaleString()
    return
  }
  const t0 = performance.now()
  const step = (): void => {
    const k = Math.min((performance.now() - t0) / 380, 1)
    el.textContent = Math.round(from + (to - from) * (1 - (1 - k) ** 3)).toLocaleString()
    if (k < 1) requestAnimationFrame(step)
  }
  step()
}

function render(stats: DashStats, standings: Standings): void {
  const city = stats.city

  $('cityPalette').innerHTML = city.palette.length
    ? city.palette.map((c) => `<i style="background:${hex(c)}"><span>${hex(c)}</span></i>`).join('')
    : '<p class="none">The archive opens today. The first photograph decides the first colour.</p>'
  $('cityReading').textContent = city.photos
    ? `${city.reading} — blended from ${city.photos} photograph${city.photos === 1 ? '' : 's'}`
    : 'Nothing has been seen yet.'

  countUp($('cPhotos'), stats.photos)
  countUp($('cClaims'), stats.totalClaims)
  countUp($('cActive'), stats.activeClaims)
  countUp($('cPlayers'), stats.players)
  countUp($('cPlaces'), stats.landmarks)

  $('byHour').innerHTML =
    city.byHour
      .map(
        (h) =>
          `<div class="hourrow"><span class="hl">${String(h.hour).padStart(2, '0')}:00</span>` +
          `<span class="hp">${h.palette.map((c) => `<i style="background:${hex(c)}"></i>`).join('')}</span>` +
          `<span class="hn">${h.n}</span></div>`,
      )
      .join('') || '<p class="none">Not enough yet.</p>'

  const pct = (n: number): string => `${Math.round(n * 100)}%`
  $('verify').innerHTML =
    `<div class="vrow"><span>attempts logged</span><b>${stats.attempts}</b></div>` +
    `<div class="vrow"><span>pass rate</span><b>${stats.attempts ? pct(stats.passRate) : '—'}</b></div>` +
    `<div class="vrow"><span>mean confidence</span><b>${
      stats.meanConfidence ? stats.meanConfidence + '%' : 'not checked'
    }</b></div>` +
    stats.confidenceByTier
      .filter((t) => t.n > 0)
      .map(
        (t) =>
          `<div class="vrow sub2"><span>${TIER_LABEL[t.tier as Tier]} tier · ${t.n}</span><b>${t.mean}%</b></div>`,
      )
      .join('')

  const maxRej = Math.max(...stats.rejections.map((r) => r.n), 1)
  $('rejections').innerHTML =
    stats.rejections
      .map(
        (r) =>
          `<div class="row"><span class="rl">${
            REJECT_TEXT[r.reason as keyof typeof REJECT_TEXT] ?? r.reason
          }</span><span class="rb"><i style="width:${(r.n / maxRej) * 100}%"></i></span><span class="rn">${r.n}</span></div>`,
      )
      .join('') || '<p class="none">Nothing refused yet.</p>'

  // sparkline
  const { counts, t0, bucketMs } = stats.timeline
  const W = 960
  const H = 130
  const max = Math.max(...counts, 1)
  let start = counts.findIndex((c) => c > 0)
  if (start < 0) start = counts.length - 10
  start = Math.max(0, Math.min(start - 1, counts.length - 10))
  const shown = counts.slice(start)
  const bw = W / shown.length
  $('spark').innerHTML =
    shown
      .map((c, i) => {
        const h = c === 0 ? 2 : Math.max((c / max) * (H - 22), 4)
        return `<rect x="${i * bw + bw * 0.18}" y="${H - h}" width="${bw * 0.64}" height="${h}" class="sb"/>`
      })
      .join('') + `<line x1="0" y1="${H - 1}" x2="${W}" y2="${H - 1}" class="sa"/>`
  const fmt = (ms: number): string =>
    new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  $('sparkAxis').innerHTML = `<span>${fmt(t0 + start * bucketMs)}</span><span>now</span>`

  const board = (rows: LeaderRow[], metric: (l: LeaderRow) => number, unit: string): string =>
    rows
      .slice(0, 8)
      .map(
        (l, i) =>
          `<li><span class="rk">${i + 1}</span>` +
          `<i class="dot" style="background:${escapeHtml(l.avatarColor)}"></i>${escapeHtml(l.handle)}` +
          `<b>${metric(l)}<span class="unit"> ${unit}</span></b></li>`,
      )
      .join('') || '<li class="none">No one yet.</li>'

  $('boardHolding').innerHTML = board(standings.holding, (l) => l.holding, 'held')
  $('boardVisited').innerHTML = board(standings.visited, (l) => l.visited, 'places')

  $('contested').innerHTML =
    stats.mostContested.map((c) => `<li>${c.name}<b>${c.n}</b></li>`).join('') ||
    '<li class="none">No claims yet.</li>'

  const e = city.extremes
  $('extremes').innerHTML =
    [
      ['most vivid', e.mostVivid],
      ['dimmest', e.dimmest],
      ['most open sky', e.openest],
    ]
      .filter(([, v]) => v)
      .map(([k, v]) => `<span class="ex"><i>${k}</i><b>${v}</b></span>`)
      .join('') || '<p class="none">Not enough photographs yet.</p>'
}

function connect(): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${location.host}/ws`)
  ws.onopen = () => setLive(true)
  ws.onmessage = (ev) => {
    let m: ServerMsg
    try {
      m = JSON.parse(ev.data)
    } catch {
      return
    }
    if (m.t === 'init' || m.t === 'tick') {
      render(m.stats, m.standings)
      applyHeat(m.stats.heat)
      // Only init carries the backlog; ticks would otherwise wipe entries that
      // arrived live since the last one.
      if (m.t === 'init') setFeed(m.feed)
      beat()
    } else if (m.t === 'claimed') {
      // The whole point of this page: a claim lands while judges are watching.
      pushFeed(m.entry)
      beat()
    }
  }
  ws.onclose = () => {
    setLive(false)
    setTimeout(connect, 1500)
  }
}

initHeatmap()
paintFeed()
connect()
