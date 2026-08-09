// Pulls real landmarks from OpenStreetMap once, cleans them, and writes them to
// sqlite. Run before the event, never at request time:  npm run seed

import { BBOX, ICONIC, MAJOR, MAX_LANDMARKS, VENUE, VENUE_TRIVIA, type Tier } from '../shared/config'
import { haversineM } from '../shared/geo'
import type { Landmark } from '../shared/types'
import { insertLandmarks, landmarkCount } from './db'

// Density comes from the small stuff — murals, memorials, fountains, clocks —
// as much as from famous sites. Wide tag list on purpose.
//
// Every family is queried as both node and way: churches, theatres, libraries,
// stadiums and towers are usually mapped as building outlines rather than
// points, and querying only nodes silently drops most of them. `out center`
// gives each way a representative coordinate.
const B = `(${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east})`
const QUERY = `[out:json][timeout:180];
(
  nwr["tourism"~"attraction|artwork|museum|viewpoint|gallery|zoo|aquarium"]${B};
  nwr["historic"]${B};
  nwr["artwork_type"]${B};
  nwr["memorial"]${B};
  nwr["amenity"~"place_of_worship|theatre|arts_centre|fountain|clock|library|marketplace"]${B};
  nwr["leisure"~"park|garden|stadium|nature_reserve"]${B};
  nwr["man_made"~"tower|lighthouse|obelisk|bridge"]${B};
  nwr["building"~"cathedral|chapel|stadium|train_station"]${B};
);
out center tags;`

/** OSM tags worth keeping verbatim — the grounding a question can be built on
 *  without anything being invented. Everything else is dropped. */
const FACT_TAGS = [
  'inscription',
  'description',
  'artist_name',
  'artwork_type',
  'start_date',
  'opening_date',
  'building:architecture',
  'architect',
  'heritage',
  'heritage:operator',
  'historic',
  'historic:civilization',
  'memorial',
  'memorial:type',
  'material',
  'height',
  'religion',
  'denomination',
  'operator',
  'website',
  'wikipedia',
  'wikidata',
  'ele',
  'addr:street',
]

function factsOf(tags: Record<string, string>): string | null {
  const kept: Record<string, string> = {}
  for (const k of FACT_TAGS) if (tags[k]) kept[k] = tags[k].slice(0, 300)
  return Object.keys(kept).length ? JSON.stringify(kept) : null
}

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
  // --force reseeds in place. Landmarks are written with INSERT OR REPLACE and
  // keyed by OSM id, so re-running widens the map without touching the photo
  // archive or the claim history — you should not have to delete data/ (and
  // lose every photograph) just to add landmarks.
  const force = process.argv.includes('--force')
  if (landmarkCount() > 0 && !force) {
    console.log(
      `[seed] ${landmarkCount()} landmarks already present — ` +
        'run `npm run seed -- --force` to re-pull and widen (keeps photos and claims)',
    )
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
      osmFacts: factsOf(el.tags ?? {}),
      photoCount: 0,
      funFact: null,
      splatUrl: null,
      splatState: 'none',
      splatPhotos: 0,
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
    osmFacts: null,
    photoCount: 0,
    funFact: JSON.stringify(VENUE_TRIVIA),
    splatUrl: null,
    splatState: 'none',
    splatPhotos: 0,
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
  const walkable = near.filter(
    (l) => haversineM(VENUE.lat, VENUE.lng, l.lat, l.lng) <= 2000,
  ).length
  console.log(
    `[seed] ${walkable} within a 2km walk of the venue · furthest is ${(furthest / 1000).toFixed(1)}km`,
  )
  process.exit(0)
}

void main()
