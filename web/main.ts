import type { FeatureCollection, Point } from 'geojson'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { CFG, TIER_LABEL, VENUE } from '../shared/config'
import { fmtDistance, haversineM } from '../shared/geo'
import { hex } from '../shared/palette'
import type {
  ArchiveResponse,
  ClaimResponse,
  LandmarkPin,
  LandmarkState,
  LeaderRow,
  Photo,
  ServerMsg,
  Standings,
} from '../shared/types'
import { analyse, shrink } from './analyse'

const $ = (id: string): HTMLElement => document.getElementById(id)!

/* ---------------- identity (a handle, nothing more) ---------------- */

function getHandle(): string | null {
  return localStorage.getItem('seen_handle')
}
function askHandle(): string | null {
  const cur = getHandle() ?? ''
  const v = prompt('Pick a handle — this is how you appear on the map. No account, no email.', cur)
  if (v && v.trim().length >= 2) {
    localStorage.setItem('seen_handle', v.trim().slice(0, 24))
    paintHandle()
    return getHandle()
  }
  return getHandle()
}
function paintHandle(): void {
  $('meBtn').textContent = getHandle() ?? 'Who are you?'
}

/* ---------------- state ---------------- */

let landmarks: LandmarkPin[] = []
const byId = new Map<string, LandmarkPin>()
const markers = new Map<string, maplibregl.Marker>()
let here: { lat: number; lng: number; accuracy: number } | null = null
let openId: string | null = null

/** Below this zoom the city is drawn as clustered counts; at or above it, as
 *  individual pins. A DOM marker per landmark is the right call for a few
 *  hundred and completely wrong for four thousand — the browser cannot lay out
 *  that many absolutely-positioned nodes on every map move. */
const PIN_ZOOM = 14
/** Hard ceiling on live DOM markers, whatever the viewport contains. */
const MAX_PINS = 500

/* ---------------- map ---------------- */

const map = new maplibregl.Map({
  container: 'map',
  // OpenFreeMap: genuinely free vector tiles, no key, no signup, no billing.
  // Positron (near-grayscale) on purpose: the only colour on screen should be
  // colour that came out of people's photographs.
  style: 'https://tiles.openfreemap.org/styles/positron',
  center: [VENUE.lng, VENUE.lat],
  zoom: 15.2,
  attributionControl: { compact: true },
})
map.once('error', () => {
  // if positron ever disappears, fall back to the default style rather than a blank map
  map.setStyle('https://tiles.openfreemap.org/styles/liberty')
})
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
// debug handle; harmless in production
;(window as unknown as { __map: maplibregl.Map }).__map = map

let meMarker: maplibregl.Marker | null = null

// Markers cannot be projected until the style is up. The socket often beats it,
// so anything that arrives early waits here rather than landing at 0,0.
let mapReady = false
map.on('load', () => {
  mapReady = true
  installClusterLayers()
  syncMarkers()
})
map.on('error', (e) => console.warn('[map]', e.error?.message ?? e))
map.on('moveend', syncMarkers)
map.on('zoomend', syncMarkers)

function markerEl(l: LandmarkPin): HTMLElement {
  // Ownership is time-derived: a hold that lapsed since the last broadcast must
  // render as free without waiting for a reload.
  const owner = l.owner && l.owner.expiresAt > Date.now() ? l.owner : null
  const el = document.createElement('button')
  el.className = 'pin' + (owner ? ' owned' : ' free') + (l.tier >= 2 ? ' major' : '')
  el.type = 'button'
  const colour = owner ? owner.avatarColor : l.tint ? hex(l.tint) : null
  if (colour) el.style.setProperty('--pc', colour)
  el.innerHTML =
    `<span class="pin-dot">${owner ? owner.handle.slice(0, 1).toUpperCase() : ''}</span>` +
    (l.photoCount > 0 ? `<span class="pin-n">${l.photoCount}</span>` : '')
  el.title = l.name
  el.onclick = (e) => {
    e.stopPropagation()
    void openSheet(l.id)
  }
  return el
}

/* ---------------- rendering a whole city ---------------- */

function pinsGeoJSON(): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: landmarks.map((l) => ({
      type: 'Feature',
      properties: { id: l.id, held: l.owner && l.owner.expiresAt > Date.now() ? 1 : 0 },
      geometry: { type: 'Point', coordinates: [l.lng, l.lat] },
    })),
  }
}

/** Clustered counts, drawn by the GPU, for every zoom below PIN_ZOOM. Tapping a
 *  cluster zooms into it, which is how you get from "the GTA" to a street. */
function installClusterLayers(): void {
  map.addSource('pins', {
    type: 'geojson',
    data: pinsGeoJSON(),
    cluster: true,
    clusterRadius: 55,
    clusterMaxZoom: PIN_ZOOM - 1,
  })

  map.addLayer({
    id: 'clusters',
    type: 'circle',
    source: 'pins',
    filter: ['has', 'point_count'],
    maxzoom: PIN_ZOOM,
    paint: {
      'circle-color': '#17181c',
      'circle-opacity': 0.86,
      'circle-stroke-width': 2.5,
      'circle-stroke-color': '#f7f5ef',
      // Area should read as quantity, so step the radius with the count.
      'circle-radius': ['step', ['get', 'point_count'], 15, 10, 20, 50, 26, 200, 33],
    },
  })

  map.addLayer({
    id: 'cluster-count',
    type: 'symbol',
    source: 'pins',
    filter: ['has', 'point_count'],
    maxzoom: PIN_ZOOM,
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 12,
    },
    paint: { 'text-color': '#f7f5ef' },
  })

  // Single places below PIN_ZOOM still deserve a dot, or a lone landmark in the
  // suburbs would simply vanish between zoom levels.
  map.addLayer({
    id: 'loners',
    type: 'circle',
    source: 'pins',
    filter: ['!', ['has', 'point_count']],
    maxzoom: PIN_ZOOM,
    paint: {
      'circle-radius': 5,
      'circle-color': ['case', ['==', ['get', 'held'], 1], '#e5533d', '#17181c'],
      'circle-opacity': 0.8,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#f7f5ef',
    },
  })

  map.on('click', 'clusters', (e) => {
    const f = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0]
    const src = map.getSource('pins') as maplibregl.GeoJSONSource
    void src.getClusterExpansionZoom(f.properties.cluster_id as number).then((z) => {
      map.easeTo({ center: (f.geometry as Point).coordinates as [number, number], zoom: z })
    })
  })
  map.on('click', 'loners', (e) => {
    const id = map.queryRenderedFeatures(e.point, { layers: ['loners'] })[0]?.properties.id
    if (typeof id === 'string') void openSheet(id)
  })
  for (const layer of ['clusters', 'loners']) {
    map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''))
  }
}

function refreshClusterSource(): void {
  if (!mapReady) return
  const src = map.getSource('pins') as maplibregl.GeoJSONSource | undefined
  if (src) src.setData(pinsGeoJSON())
}

/** Keep a DOM marker for every landmark on screen, and none for any that isn't.
 *  Diffed rather than rebuilt, so panning costs only what actually changed. */
function syncMarkers(): void {
  if (!mapReady) return

  if (map.getZoom() < PIN_ZOOM) {
    for (const m of markers.values()) m.remove()
    markers.clear()
    return
  }

  const b = map.getBounds()
  const wanted = new Set<string>()
  for (const l of landmarks) {
    if (l.lng < b.getWest() || l.lng > b.getEast()) continue
    if (l.lat < b.getSouth() || l.lat > b.getNorth()) continue
    wanted.add(l.id)
    if (wanted.size >= MAX_PINS) break
  }

  for (const [id, m] of markers) {
    if (!wanted.has(id)) {
      m.remove()
      markers.delete(id)
    }
  }
  for (const id of wanted) {
    if (markers.has(id)) continue
    const l = byId.get(id)
    if (!l) continue
    markers.set(
      id,
      new maplibregl.Marker({ element: markerEl(l) }).setLngLat([l.lng, l.lat]).addTo(map),
    )
  }
}

/** Re-render the pins already on screen — used when a hold lapses with time. */
function repaintVisible(): void {
  for (const m of markers.values()) m.remove()
  markers.clear()
  syncMarkers()
}

function setLandmarks(list: LandmarkPin[]): void {
  landmarks = list
  byId.clear()
  for (const l of list) byId.set(l.id, l)
}

/* ---------------- the city in three dimensions ---------------- */
//
// Every place is a column. Unphotographed places are low grey stubs — the city
// as it stands. Each photograph raises its column and pulls it toward the
// colour of what was actually photographed there. So the skyline *is* the
// dataset: height is attention, colour is what the place looks like.

let cityOn = false

function squareAround(lng: number, lat: number, m: number): [number, number][][] {
  const dLat = m / 111_320
  const dLng = m / (111_320 * Math.cos((lat * Math.PI) / 180))
  return [
    [
      [lng - dLng, lat - dLat],
      [lng + dLng, lat - dLat],
      [lng + dLng, lat + dLat],
      [lng - dLng, lat + dLat],
      [lng - dLng, lat - dLat],
    ],
  ]
}

interface CityFeature {
  type: 'Feature'
  properties: { height: number; colour: string; name: string }
  geometry: { type: 'Polygon'; coordinates: [number, number][][] }
}

interface CityData {
  type: 'FeatureCollection'
  features: CityFeature[]
}

function cityGeoJSON(): CityData {
  return {
    type: 'FeatureCollection',
    features: landmarks.map((l) => ({
      type: 'Feature',
      properties: {
        height: 10 + l.photoCount * 34,
        colour: l.tint ? hex(l.tint) : '#b9b6ae',
        name: l.name,
      },
      geometry: {
        type: 'Polygon',
        coordinates: squareAround(l.lng, l.lat, l.tier >= 2 ? 26 : 17),
      },
    })),
  }
}

function refreshCity(): void {
  if (!mapReady) return
  const src = map.getSource('city') as maplibregl.GeoJSONSource | undefined
  if (src) src.setData(cityGeoJSON() as unknown as Parameters<typeof src.setData>[0])
}

function toggleCity(): void {
  if (!mapReady) return
  cityOn = !cityOn
  const btn = document.getElementById('cityBtn')
  if (btn) btn.classList.toggle('on', cityOn)

  if (cityOn) {
    if (!map.getSource('city')) {
      map.addSource('city', {
        type: 'geojson',
        data: cityGeoJSON(),
      } as unknown as Parameters<typeof map.addSource>[1])
      map.addLayer({
        id: 'city',
        type: 'fill-extrusion',
        source: 'city',
        paint: {
          'fill-extrusion-color': ['get', 'colour'],
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.92,
        },
      })
    } else {
      map.setLayoutProperty('city', 'visibility', 'visible')
      refreshCity()
    }
    // Applied instantly, not eased: a geolocation fix arriving mid-flight
    // cancels an in-progress easeTo and leaves the map flat.
    map.setPitch(55)
    map.setBearing(-20)
    if (map.getZoom() < 15.4) map.setZoom(15.4)
  } else {
    if (map.getLayer('city')) map.setLayoutProperty('city', 'visibility', 'none')
    map.setPitch(0)
    map.setBearing(0)
  }
}

/* ---------------- geolocation ---------------- */

function watchMe(): void {
  if (!navigator.geolocation) return
  navigator.geolocation.watchPosition(
    (pos) => {
      here = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }
      if (!meMarker) {
        const el = document.createElement('div')
        el.className = 'me'
        meMarker = new maplibregl.Marker({ element: el }).setLngLat([here.lng, here.lat]).addTo(map)
        map.easeTo({ center: [here.lng, here.lat], zoom: 16 })
      } else {
        meMarker.setLngLat([here.lng, here.lat])
      }
      if (openId) refreshDistance()
    },
    () => {
      // Denied or unavailable: the map still works, you just cannot claim.
      here = null
      const b = document.getElementById('claimBtn')
      if (b) {
        b.setAttribute('disabled', '')
        b.textContent = 'Location needed to claim'
      }
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
  )
}

function refreshDistance(): void {
  const l = landmarks.find((x) => x.id === openId)
  const out = document.getElementById('dist')
  const btn = document.getElementById('claimBtn') as HTMLButtonElement | null
  if (!l || !out) return
  if (!here) {
    out.textContent = 'Location off'
    return
  }
  const d = haversineM(here.lat, here.lng, l.lat, l.lng)
  const radius = l.id === 'venue' ? VENUE.radiusM : CFG.claimRadiusM
  out.textContent = `${fmtDistance(d)} away`
  out.className = 'dist ' + (d <= radius ? 'near' : 'far')
  if (btn && !l.owner) {
    if (d <= radius) {
      btn.disabled = false
      btn.textContent = 'Take the photo'
    } else {
      btn.disabled = true
      btn.textContent = `Get within ${radius}m`
    }
  }
}

/* ---------------- landmark sheet ---------------- */

// Category strings come straight from OSM tag values (see server/seed.ts
// categoryOf) — that space is wide (museum, viewpoint, castle, clock, ...),
// so this only names the categories that actually dominate the seeded set.
// Anything else, including the literal 'place' fallback, falls through to
// default.svg rather than a missing image.
const NAMED_CATEGORY_ICONS = new Set([
  'park',
  'artwork',
  'memorial',
  'attraction',
  'place_of_worship',
  'gallery',
  'arts_centre',
  'theatre',
  'fountain',
])

function categoryIconUrl(category: string): string {
  const key = NAMED_CATEGORY_ICONS.has(category) ? category : 'default'
  return `/brand/category/${key}.svg`
}

function photoStrip(photos: Photo[]): string {
  if (photos.length === 0) {
    return `<p class="none">No one has photographed this yet.</p>`
  }
  return (
    `<div class="strip">` +
    photos
      .slice(0, 40)
      .map(
        (p) =>
          `<figure class="shot"><img loading="lazy" src="/photos/${p.id}.jpg" alt="" />` +
          `<figcaption>${p.handle}<span>${new Date(p.takenAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></figcaption></figure>`,
      )
      .join('') +
    `</div>`
  )
}

async function openSheet(id: string): Promise<void> {
  openId = id
  const sheet = $('sheet')
  sheet.removeAttribute('hidden')
  $('sheetBody').innerHTML = `<p class="none">Loading…</p>`

  let data: ArchiveResponse
  try {
    data = (await (await fetch(`/api/landmark/${encodeURIComponent(id)}`)).json()) as ArchiveResponse
  } catch {
    $('sheetBody').innerHTML = `<p class="none">Couldn't load this place.</p>`
    return
  }

  const l = data.landmark
  const owned = l.owner
  const mins = owned ? Math.max(0, Math.ceil((owned.expiresAt - Date.now()) / 60_000)) : 0

  $('sheetBody').innerHTML = `
    <div class="sheet-head">
      <div class="sheet-head-main">
        <img class="cat-icon" src="${categoryIconUrl(l.category)}" width="28" height="28" alt=""
             onerror="this.style.display='none'" />
        <div>
          <h2>${l.name}</h2>
          <p class="meta">${TIER_LABEL[l.tier]} · ${l.category}${
            l.photoCount ? ` · seen by ${l.photoCount} ${l.photoCount === 1 ? 'person' : 'people'}` : ''
          }</p>
        </div>
      </div>
      <span id="dist" class="dist">—</span>
    </div>
    ${
      l.palette.length
        ? `<div class="placecolour">${l.palette
            .map((c) => `<i style="background:${hex(c)}"></i>`)
            .join('')}<span>this place's colour</span></div>`
        : ''
    }
    ${
      owned
        ? `<div class="owner" style="--oc:${owned.avatarColor}"><b>${owned.handle}</b> holds this for ${mins} more min</div>`
        : `<div class="owner free">Unclaimed — be the one who takes it</div>`
    }
    <div class="actions">
      <button id="claimBtn" class="claim" ${owned ? 'disabled' : ''}>${
        owned ? 'Held right now' : 'Take the photo'
      }</button>
      <button id="dirBtn" class="claim ghost2">Walk me there</button>
    </div>
    <div id="routeInfo" class="routeinfo"></div>
    ${l.gated ? `<p class="gate-flag">🔒 Iconic — answer its question to unlock the camera</p>` : ''}
    ${funFactHtml(l.funFact, l.category)}
    <h3 class="archive-h">Everything anyone has photographed here</h3>
    ${photoStrip(data.photos)}
  `
  wireFunFact()

  const btn = document.getElementById('claimBtn') as HTMLButtonElement
  btn.onclick = () => {
    if (!getHandle() && !askHandle()) return
    pendingAnswer = null
    const camera = (): void => ($('camera') as HTMLInputElement).click()
    if (l.gated) openGate(l, camera)
    else camera()
  }
  const dir = document.getElementById('dirBtn')
  if (dir) dir.onclick = () => void showRoute(l.id)
  refreshDistance()
}

/* ---------------- fun fact (flavor on ordinary places) ---------------- */

function funFactHtml(raw: string | null, category: string): string {
  if (!raw) return ''
  try {
    const f = JSON.parse(raw) as {
      question: string
      options: string[]
      correctIndex: number
      scope?: 'place' | 'category'
    }
    // A question about murals in general must not read as a fact about *this*
    // mural. The summary line says which it is, before you open it.
    const general = f.scope === 'category'
    const label = general ? `💡 About ${category}s in general` : '💡 About this place'
    const note = general
      ? `A general question about ${category}s — the record for this one is just a name.`
      : 'Built from this place&rsquo;s own record. AI-written, so treat it as flavour.'
    return (
      `<details class="funfact${general ? ' general' : ''}" data-correct="${f.correctIndex}">` +
      `<summary>${label}</summary>` +
      `<p class="ff-q">${f.question}</p>` +
      f.options.map((o, i) => `<button class="ff-opt" data-i="${i}">${o}</button>`).join('') +
      `<p class="ff-note" hidden>${note}</p></details>`
    )
  } catch {
    return ''
  }
}

function wireFunFact(): void {
  const d = document.querySelector<HTMLElement>('.funfact')
  if (!d) return
  const correct = Number(d.dataset.correct)
  d.querySelectorAll<HTMLButtonElement>('.ff-opt').forEach((b) => {
    b.onclick = () => {
      d.querySelectorAll<HTMLButtonElement>('.ff-opt').forEach((x, i) => {
        x.disabled = true
        if (i === correct) x.classList.add('right')
        else if (x === b) x.classList.add('wrong')
      })
      const note = d.querySelector<HTMLElement>('.ff-note')
      if (note) note.hidden = false
    }
  })
}

/* ---------------- standings ---------------- */

let standings: Standings | null = null
let boardTab: 'holding' | 'visited' = 'holding'

/** Your row, wherever it is. The whole point of a leaderboard for a player who
 *  is not winning is being able to find themselves on it. */
function boardHtml(): string {
  if (!standings || standings.players === 0) {
    return `<p class="none">Nobody has claimed anything yet. Take a place and you are rank 1.</p>`
  }
  const rows = boardTab === 'holding' ? standings.holding : standings.visited
  const value = (l: LeaderRow): number => (boardTab === 'holding' ? l.holding : l.visited)
  const unit = boardTab === 'holding' ? 'held' : 'places'
  const me = getHandle()
  const myIndex = me ? rows.findIndex((r) => r.handle === me) : -1

  const row = (l: LeaderRow, i: number): string =>
    `<li class="${l.handle === me ? 'me' : ''}"><span class="rk">${i + 1}</span>` +
    `<i class="dot" style="background:${l.avatarColor}"></i>` +
    `<span class="nm">${l.handle}</span><b>${value(l)}<span class="unit"> ${unit}</span></b></li>`

  const top = rows.slice(0, 10).map(row).join('')
  // Outside the top ten, pin your own row on the end rather than hiding it.
  const mine =
    myIndex >= 10
      ? `<li class="gap">⋯</li>` + row(rows[myIndex], myIndex)
      : myIndex < 0 && me
        ? `<li class="none">You have not claimed anywhere yet.</li>`
        : ''

  return `<ol class="board">${top}${mine}</ol>`
}

/** Your standing, above the fold. Highlighting your row in the list is not
 *  enough when you are eighth of eight — you would have to scroll to find out
 *  where you are, which is the one thing you opened this to learn. */
function myStandingHtml(): string {
  const me = getHandle()
  if (!me) return `<p class="boardme none">Pick a handle to appear on the board.</p>`
  if (!standings || standings.players === 0) return ''
  const rows = boardTab === 'holding' ? standings.holding : standings.visited
  const i = rows.findIndex((r) => r.handle === me)
  if (i < 0) {
    return `<p class="boardme none">You are not on this board yet — claim somewhere to join it.</p>`
  }
  const row = rows[i]
  const value = boardTab === 'holding' ? row.holding : row.visited
  const unit = boardTab === 'holding' ? (value === 1 ? 'place held' : 'places held') : 'places visited'
  return (
    `<div class="boardme"><i class="dot" style="background:${row.avatarColor}"></i>` +
    `<span>You are <b>#${i + 1}</b> of ${standings.players}</span>` +
    `<b class="v">${value}<span class="unit"> ${unit}</span></b></div>`
  )
}

function paintBoard(): void {
  const panel = document.getElementById('boardBody')
  if (!panel) return
  panel.innerHTML =
    `<div class="boardtabs">` +
    `<button class="btab${boardTab === 'holding' ? ' on' : ''}" data-t="holding">Holding now</button>` +
    `<button class="btab${boardTab === 'visited' ? ' on' : ''}" data-t="visited">Places visited</button>` +
    `</div>` +
    myStandingHtml() +
    boardHtml() +
    `<p class="boardnote">${
      boardTab === 'holding'
        ? 'Holds lapse after three hours. This board moves while you sleep.'
        : 'Every place you have ever claimed, counted once. Nobody can take these back.'
    }</p>`
  panel.querySelectorAll<HTMLButtonElement>('.btab').forEach((b) => {
    b.onclick = () => {
      boardTab = b.dataset.t === 'visited' ? 'visited' : 'holding'
      paintBoard()
    }
  })
}

function openBoard(): void {
  $('board').removeAttribute('hidden')
  paintBoard()
}

/* ---------------- the iconic-tier gate (§3.6) ---------------- */

// The answer lives only on the server: a gated landmark ships its question and
// options and nothing else. Answering here just unlocks the camera early — the
// claim carries the answer and the server grades it again for real.
let pendingAnswer: number | null = null

function openGate(l: LandmarkState, onPass: () => void): void {
  if (!l.trivia) {
    onPass()
    return
  }
  showModal(`
    <div class="gate">
      <p class="gate-tier">Iconic — you have to know it to take it</p>
      <h2>${l.name}</h2>
      <p class="gate-q">${l.trivia.question}</p>
      <div class="gate-opts">
        ${l.trivia.options.map((o, i) => `<button class="ff-opt" data-i="${i}">${o}</button>`).join('')}
      </div>
      <p class="gate-note" hidden></p>
    </div>`)

  const note = document.querySelector<HTMLElement>('.gate-note')
  document.querySelectorAll<HTMLButtonElement>('.gate-opts .ff-opt').forEach((b) => {
    b.onclick = async () => {
      const i = Number(b.dataset.i)
      document.querySelectorAll<HTMLButtonElement>('.gate-opts .ff-opt').forEach((x) => {
        x.disabled = true
      })
      let correct = false
      try {
        const r = (await (
          await fetch(`/api/landmark/${encodeURIComponent(l.id)}/trivia`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ answer: i }),
          })
        ).json()) as { correct?: boolean }
        correct = r.correct === true
      } catch {
        // Network trouble must not brick the demo: let them through and let the
        // claim endpoint be the judge.
        correct = true
      }

      if (correct) {
        b.classList.add('right')
        pendingAnswer = i
        if (note) {
          note.hidden = false
          note.textContent = 'Right — opening the camera.'
        }
        setTimeout(() => {
          $('modal').setAttribute('hidden', '')
          onPass()
        }, 650)
      } else {
        b.classList.add('wrong')
        if (note) {
          note.hidden = false
          note.textContent = 'Not that one. Look around and try again.'
        }
        setTimeout(() => {
          document.querySelectorAll<HTMLButtonElement>('.gate-opts .ff-opt').forEach((x) => {
            x.disabled = false
            x.classList.remove('wrong')
          })
        }, 900)
      }
    }
  })
}

/* ---------------- walking route (§3.10) ---------------- */

interface RouteLine {
  type: 'LineString'
  coordinates: [number, number][]
}

async function showRoute(to: string): Promise<void> {
  if (!here) return
  const info = document.getElementById('routeInfo')
  if (info) info.textContent = 'Finding the way…'
  try {
    const r = (await (
      await fetch(`/api/route?fromLat=${here.lat}&fromLng=${here.lng}&to=${encodeURIComponent(to)}`)
    ).json()) as {
      fallback: boolean
      distance_m: number
      duration_s: number
      geometry: RouteLine
    }
    if (mapReady) {
      const data = { type: 'Feature' as const, properties: {}, geometry: r.geometry }
      const src = map.getSource('route') as maplibregl.GeoJSONSource | undefined
      if (src) {
        src.setData(data)
      } else {
        map.addSource('route', { type: 'geojson', data })
        map.addLayer({
          id: 'route',
          type: 'line',
          source: 'route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#17181c',
            'line-width': 4,
            'line-opacity': 0.75,
            'line-dasharray': r.fallback ? [1.5, 2] : [1, 0],
          },
        })
      }
      if (map.getLayer('route')) {
        map.setPaintProperty('route', 'line-dasharray', r.fallback ? [1.5, 2] : [1, 0])
      }
    }
    if (info) {
      const mins = Math.max(1, Math.round(r.duration_s / 60))
      info.textContent = `${fmtDistance(r.distance_m)} · about ${mins} min on foot${
        r.fallback ? ' (as the crow flies)' : ''
      }`
    }
  } catch {
    if (info) info.textContent = 'Routing unavailable — follow the map'
  }
}

function clearRoute(): void {
  if (mapReady && map.getLayer('route')) {
    map.removeLayer('route')
    map.removeSource('route')
  }
}

function closeSheet(): void {
  openId = null
  $('sheet').setAttribute('hidden', '')
  clearRoute()
}

/* ---------------- capture → claim ---------------- */

$('camera').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !openId) return

  showModal(`<div class="working"><div class="spinner"></div><p>Reading the photograph…</p></div>`)

  try {
    const [dataUrl, analysis] = await Promise.all([shrink(file), analyse(file)])
    showModal(`<div class="working"><div class="spinner"></div><p>Checking where you are…</p></div>`)

    const res = (await (
      await fetch('/api/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          landmarkId: openId,
          handle: getHandle(),
          lat: here?.lat,
          lng: here?.lng,
          accuracy: here?.accuracy,
          photo: dataUrl,
          analysis,
          triviaAnswer: pendingAnswer,
        }),
      })
    ).json()) as ClaimResponse

    if (!res.ok) {
      showModal(`
        <div class="verdict bad">
          <h2>Not this time</h2>
          <p>${res.message ?? 'That did not go through.'}</p>
          <button class="claim" onclick="document.getElementById('modal').setAttribute('hidden','')">Try again</button>
        </div>`)
      return
    }

    fireShutter()
    const chips = (p?: [number, number, number][]): string =>
      p && p.length
        ? p.slice(0, 5).map((c) => `<i style="background:${hex(c)}"></i>`).join('')
        : '<i class="nochip"></i>'
    showModal(`
      <div class="verdict good">
        <h2>Claimed</h2>
        <img class="yours" src="${dataUrl}" alt="your photograph" />
        <p class="shift">${res.shifted ?? ''}</p>
        <div class="beforeafter">
          <div><i class="ba-label">before</i><span class="chips">${chips(res.beforePalette)}</span></div>
          <div><i class="ba-label">after you</i><span class="chips">${chips(res.afterPalette)}</span></div>
        </div>
        <p class="fine">${Math.round(res.distanceM ?? 0)}m from the marker${
          res.confidence ? ` · verified at ${res.confidence}% confidence` : ''
        } · +${res.points ?? 0} points</p>
        <button class="claim" id="verdictOk">See it on the map</button>
      </div>`)
    const ok = document.getElementById('verdictOk')
    if (ok) {
      ok.onclick = () => {
        $('modal').setAttribute('hidden', '')
        if (openId) void openSheet(openId)
      }
    }
  } catch (err) {
    showModal(`
      <div class="verdict bad">
        <h2>Something broke</h2>
        <p>${(err as Error).message}</p>
        <button class="claim" onclick="document.getElementById('modal').setAttribute('hidden','')">Close</button>
      </div>`)
  }
})

function showModal(html: string): void {
  $('modalBody').innerHTML = html
  $('modal').removeAttribute('hidden')
}

/** A camera-shutter iris, fired once on a successful claim — the product's
 *  entire atomic action is "take a photo," so the moment it lands should
 *  feel like one, not like a form submitting. Self-contained: builds its own
 *  overlay, animates it, and removes itself — no persistent DOM, no state to
 *  leak if a claim never succeeds in a session. */
function fireShutter(): void {
  const el = document.createElement('div')
  el.className = 'shutter'
  document.body.appendChild(el)
  el.addEventListener('animationend', () => el.remove(), { once: true })
  setTimeout(() => el.remove(), 900) // in case the animation is skipped or interrupted
}

/* ---------------- live ---------------- */

function paintColourbar(palette: [number, number, number][]): void {
  $('colourbar').innerHTML = palette.map((c) => `<i style="background:${hex(c)}"></i>`).join('')
}

function connect(): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${location.host}/ws`)
  ws.onmessage = (ev) => {
    let m: ServerMsg
    try {
      m = JSON.parse(ev.data)
    } catch {
      return
    }
    if (m.t === 'init') {
      standings = m.standings
      setLandmarks(m.landmarks)
      refreshClusterSource()
      syncMarkers()
      refreshCity()
      paintColourbar(m.stats.city.palette)
    } else if (m.t === 'claimed') {
      const i = landmarks.findIndex((l) => l.id === m.landmark.id)
      if (i >= 0) landmarks[i] = m.landmark
      byId.set(m.landmark.id, m.landmark)
      refreshClusterSource()
      // Only redraw the marker if that place is actually on screen; a claim
      // across the city must not add a node to this viewport.
      if (mapReady && markers.has(m.landmark.id)) {
        markers.get(m.landmark.id)!.remove()
        markers.set(
          m.landmark.id,
          new maplibregl.Marker({ element: markerEl(m.landmark) })
            .setLngLat([m.landmark.lng, m.landmark.lat])
            .addTo(map),
        )
        refreshCity() // the column rises as the photo lands
      }
    } else if (m.t === 'tick') {
      paintColourbar(m.stats.city.palette)
      standings = m.standings
      if (!$('board').hasAttribute('hidden')) paintBoard()
    }
  }
  ws.onclose = () => setTimeout(connect, 1500)
}

/* ---------------- boot ---------------- */

$('sheetClose').onclick = closeSheet
$('meBtn').onclick = () => askHandle()
$('cityBtn').onclick = toggleCity
$('rankBtn').onclick = openBoard
$('boardClose').onclick = () => $('board').setAttribute('hidden', '')
map.on('click', closeSheet)
paintHandle()
watchMe()
connect()
setInterval(refreshDistance, 4000)
// Re-render the pins on screen each minute so 3-hour holds visibly lapse
// without a reload. Only the visible ones — syncMarkers alone would leave an
// already-mounted marker untouched, and repainting all 4000 would be absurd.
setInterval(repaintVisible, 60_000)

// One-time explainer — a stranger's first 10 seconds, then never again.
if (!localStorage.getItem('seen_intro')) {
  $('intro').removeAttribute('hidden')
  $('introOk').onclick = () => {
    localStorage.setItem('seen_intro', '1')
    $('intro').setAttribute('hidden', '')
  }
}
