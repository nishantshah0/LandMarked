import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { CFG, TIER_LABEL, VENUE } from '../shared/config'
import { fmtDistance, haversineM } from '../shared/geo'
import { hex } from '../shared/palette'
import type {
  ArchiveResponse,
  ClaimResponse,
  LandmarkState,
  Photo,
  ServerMsg,
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

let landmarks: LandmarkState[] = []
const markers = new Map<string, maplibregl.Marker>()
let here: { lat: number; lng: number; accuracy: number } | null = null
let openId: string | null = null

/* ---------------- map ---------------- */

const map = new maplibregl.Map({
  container: 'map',
  // OpenFreeMap: genuinely free vector tiles, no key, no signup, no billing.
  style: 'https://tiles.openfreemap.org/styles/liberty',
  center: [VENUE.lng, VENUE.lat],
  zoom: 15.2,
  attributionControl: { compact: true },
})
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')

let meMarker: maplibregl.Marker | null = null

function markerEl(l: LandmarkState): HTMLElement {
  const el = document.createElement('button')
  el.className = 'pin' + (l.owner ? ' owned' : ' free') + (l.tier >= 2 ? ' major' : '')
  el.type = 'button'
  const colour = l.owner ? l.owner.avatarColor : l.palette[0] ? hex(l.palette[0]) : null
  if (colour) el.style.setProperty('--pc', colour)
  el.innerHTML =
    `<span class="pin-dot">${l.owner ? l.owner.handle.slice(0, 1).toUpperCase() : ''}</span>` +
    (l.photoCount > 0 ? `<span class="pin-n">${l.photoCount}</span>` : '')
  el.title = l.name
  el.onclick = (e) => {
    e.stopPropagation()
    void openSheet(l.id)
  }
  return el
}

function syncMarkers(): void {
  for (const l of landmarks) {
    const existing = markers.get(l.id)
    if (existing) existing.remove()
    const m = new maplibregl.Marker({ element: markerEl(l) })
      .setLngLat([l.lng, l.lat])
      .addTo(map)
    markers.set(l.id, m)
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
      <div>
        <h2>${l.name}</h2>
        <p class="meta">${TIER_LABEL[l.tier]} · ${l.category}${
          l.photoCount ? ` · seen by ${l.photoCount} ${l.photoCount === 1 ? 'person' : 'people'}` : ''
        }</p>
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
    <button id="claimBtn" class="claim" ${owned ? 'disabled' : ''}>${
      owned ? 'Held right now' : 'Take the photo'
    }</button>
    <h3 class="archive-h">Everything anyone has photographed here</h3>
    ${photoStrip(data.photos)}
  `

  const btn = document.getElementById('claimBtn') as HTMLButtonElement
  btn.onclick = () => {
    if (!getHandle() && !askHandle()) return
    ;($('camera') as HTMLInputElement).click()
  }
  refreshDistance()
}

function closeSheet(): void {
  openId = null
  $('sheet').setAttribute('hidden', '')
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

    showModal(`
      <div class="verdict good">
        <h2>Claimed</h2>
        <p class="shift">${res.shifted ?? ''}</p>
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
      landmarks = m.landmarks
      syncMarkers()
      paintColourbar(m.stats.city.palette)
    } else if (m.t === 'claimed') {
      const i = landmarks.findIndex((l) => l.id === m.landmark.id)
      if (i >= 0) landmarks[i] = m.landmark
      const old = markers.get(m.landmark.id)
      if (old) old.remove()
      markers.set(
        m.landmark.id,
        new maplibregl.Marker({ element: markerEl(m.landmark) })
          .setLngLat([m.landmark.lng, m.landmark.lat])
          .addTo(map),
      )
    } else if (m.t === 'tick') {
      paintColourbar(m.stats.city.palette)
    }
  }
  ws.onclose = () => setTimeout(connect, 1500)
}

/* ---------------- boot ---------------- */

$('sheetClose').onclick = closeSheet
$('meBtn').onclick = () => askHandle()
map.on('click', closeSheet)
paintHandle()
watchMe()
connect()
setInterval(refreshDistance, 4000)
