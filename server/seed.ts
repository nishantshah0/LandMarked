// Pulls real landmarks from OpenStreetMap once, cleans them, and writes them to
// sqlite. Run before the event, never at request time:  npm run seed

import { BBOX, ICONIC, MAJOR, MAX_LANDMARKS, VENUE, type Tier } from '../shared/config'
import { haversineM } from '../shared/geo'
import type { Landmark } from '../shared/types'
import { insertLandmarks, landmarkCount } from './db'

const QUERY = `[out:json][timeout:90];
(
  node["tourism"~"attraction|artwork|museum|viewpoint|gallery"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  node["historic"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  node["amenity"~"place_of_worship|theatre|arts_centre|fountain|library"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  node["leisure"~"park|stadium|garden"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  way["tourism"~"attraction|museum|artwork"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  way["historic"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  way["leisure"~"park|garden"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
);
out center tags;`

interface OverpassEl {
  type: string
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

function tierFor(name: string): Tier {
  const n = name.toLowerCase()
  if (ICONIC.some((k) => n.includes(k))) return 3
  if (MAJOR.some((k) => n.includes(k))) return 2
  return 1
}

function categoryOf(tags: Record<string, string>): string {
  return (
    tags.tourism ?? tags.historic ?? tags.amenity ?? tags.leisure ?? 'place'
  )
}

async function main(): Promise<void> {
  if (landmarkCount() > 0) {
    console.log(`[seed] ${landmarkCount()} landmarks already present — delete data/ to reseed`)
    process.exit(0)
  }

  // Overpass rejects requests without a descriptive User-Agent (406), and the
  // main instance rate-limits hard, so try the mirrors in turn.
  const MIRRORS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.osm.jp/api/interpreter',
  ]

  console.log('[seed] querying OpenStreetMap…')
  let body: { elements: OverpassEl[] } | null = null
  for (const url of MIRRORS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': 'SEEN/1.0 (hackathon project; contact via github)',
          accept: 'application/json',
        },
        body: 'data=' + encodeURIComponent(QUERY),
      })
      if (!res.ok) {
        console.warn(`[seed] ${new URL(url).hostname} returned ${res.status}, trying the next mirror…`)
        continue
      }
      body = (await res.json()) as { elements: OverpassEl[] }
      console.log(`[seed] got ${body.elements.length} elements from ${new URL(url).hostname}`)
      break
    } catch (e) {
      console.warn(`[seed] ${new URL(url).hostname} failed: ${(e as Error).message}`)
    }
  }
  if (!body) {
    console.error('[seed] every Overpass mirror refused. Wait a minute and run `npm run seed` again.')
    process.exit(1)
  }

  const raw: Landmark[] = []
  for (const el of body.elements) {
    const name = el.tags?.name
    if (!name) continue // unnamed points are unclaimable in practice
    const lat = el.lat ?? el.center?.lat
    const lng = el.lon ?? el.center?.lon
    if (lat === undefined || lng === undefined) continue
    raw.push({
      id: `${el.type[0]}${el.id}`,
      name: name.slice(0, 120),
      lat,
      lng,
      tier: tierFor(name),
      category: categoryOf(el.tags ?? {}),
      description: el.tags?.description ?? el.tags?.inscription ?? null,
      photoCount: 0,
    })
  }

  // Drop near-duplicates: OSM often carries a node and a way for one place.
  const kept: Landmark[] = []
  for (const l of raw) {
    const dupe = kept.find(
      (k) => haversineM(k.lat, k.lng, l.lat, l.lng) < 15 && k.name === l.name,
    )
    if (!dupe) kept.push(l)
  }

  // Keep only the nearest handful. Density is the whole point: thirty claims
  // spread over a city reads as abandoned, over a few blocks it reads as a scene.
  kept.sort(
    (a, b) =>
      haversineM(VENUE.lat, VENUE.lng, a.lat, a.lng) -
      haversineM(VENUE.lat, VENUE.lng, b.lat, b.lng),
  )
  const near = kept.slice(0, MAX_LANDMARKS)

  // The venue goes in by hand, tier 3, so a judge can claim it at the table.
  near.unshift({
    id: 'venue',
    name: VENUE.name,
    lat: VENUE.lat,
    lng: VENUE.lng,
    tier: 3,
    category: 'venue',
    description: 'The hackathon itself. Claimable from inside the building.',
    photoCount: 0,
  })

  insertLandmarks(near)
  const furthest = haversineM(
    VENUE.lat,
    VENUE.lng,
    near[near.length - 1].lat,
    near[near.length - 1].lng,
  )
  const byTier = near.reduce<Record<number, number>>((a, l) => {
    a[l.tier] = (a[l.tier] ?? 0) + 1
    return a
  }, {})
  console.log(
    `[seed] ${near.length} landmarks kept of ${kept.length} found — ` +
      `tier1 ${byTier[1] ?? 0} · tier2 ${byTier[2] ?? 0} · tier3 ${byTier[3] ?? 0}`,
  )
  console.log(`[seed] furthest is ${Math.round(furthest)}m from the venue — all walkable`)
  process.exit(0)
}

void main()
