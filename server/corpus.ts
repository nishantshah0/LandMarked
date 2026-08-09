// What the neighbourhood is made of, before anybody photographs it.
//
// Every figure here is computed from the real OpenStreetMap corpus we seeded —
// categories, heritage tags, inscriptions, artists, dates, Wikipedia coverage,
// how tightly the places cluster. It needs no photographs, so the data page has
// something true and specific to say from the first second, and the photographs
// layer on top of it rather than being the only thing on the page.

import { haversineM } from '../shared/geo'
import type { CorpusStats, Landmark } from '../shared/types'
import { VENUE } from '../shared/config'

/** OSM tags that count as a place telling us something real about itself. */
const GROUNDING = [
  'inscription',
  'artist_name',
  'start_date',
  'opening_date',
  'architect',
  'building:architecture',
  'material',
  'heritage',
  'memorial:type',
  'height',
  'religion',
  'operator',
  'description',
] as const

function tagsOf(l: Landmark): Record<string, string> {
  if (!l.osmFacts) return {}
  try {
    return JSON.parse(l.osmFacts) as Record<string, string>
  } catch {
    return {}
  }
}

/** Nearest-neighbour distance for one place, in metres. */
function nearestNeighbour(l: Landmark, all: Landmark[]): number {
  let best = Infinity
  for (const o of all) {
    if (o.id === l.id) continue
    const d = haversineM(l.lat, l.lng, o.lat, o.lng)
    if (d < best) best = d
  }
  return best
}

export function corpusStats(landmarks: Landmark[]): CorpusStats {
  const n = landmarks.length
  if (n === 0) {
    return {
      total: 0,
      byCategory: [],
      byTier: [],
      grounding: [],
      groundedShare: 0,
      withWikipedia: 0,
      oldest: null,
      walkBands: [],
      medianSpacingM: 0,
      questionsWritten: 0,
      questionsPlaceScoped: 0,
    }
  }

  // What kind of places these are.
  const cats = new Map<string, number>()
  for (const l of landmarks) cats.set(l.category, (cats.get(l.category) ?? 0) + 1)
  const byCategory = [...cats.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  const tiers = new Map<number, number>()
  for (const l of landmarks) tiers.set(l.tier, (tiers.get(l.tier) ?? 0) + 1)
  const byTier = [1, 2, 3]
    .map((tier) => ({ tier, count: tiers.get(tier) ?? 0 }))
    .filter((t) => t.count > 0)

  // How much these places actually say about themselves — the raw material a
  // question can be built from without inventing anything.
  const groundCounts = new Map<string, number>()
  let grounded = 0
  let withWikipedia = 0
  let oldest: CorpusStats['oldest'] = null

  for (const l of landmarks) {
    const t = tagsOf(l)
    let any = false
    for (const key of GROUNDING) {
      if (t[key]) {
        groundCounts.set(key, (groundCounts.get(key) ?? 0) + 1)
        any = true
      }
    }
    if (any) grounded++
    if (t.wikipedia) withWikipedia++

    // Earliest datable thing in the neighbourhood, from a real OSM date tag.
    const raw = t.start_date ?? t.opening_date
    const year = raw ? Number((raw.match(/\d{4}/) ?? [])[0]) : NaN
    if (Number.isFinite(year) && year > 1500 && (!oldest || year < oldest.year)) {
      oldest = { name: l.name, year }
    }
  }

  const grounding = [...groundCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)

  // How walkable the set is — the density argument, in numbers.
  const bands = [
    { label: 'under 500 m', max: 500 },
    { label: '500 m – 1 km', max: 1000 },
    { label: '1 – 2 km', max: 2000 },
    { label: 'over 2 km', max: Infinity },
  ]
  const walkBands = bands.map((b) => ({ label: b.label, count: 0 }))
  for (const l of landmarks) {
    const d = haversineM(VENUE.lat, VENUE.lng, l.lat, l.lng)
    const i = bands.findIndex((b) => d < b.max)
    walkBands[i === -1 ? bands.length - 1 : i].count++
  }

  // Median spacing: capped so a 4,000-landmark corpus doesn't cost O(n²) on
  // every dashboard tick — a 300-place sample estimates the median fine.
  const sample = landmarks.length > 300 ? landmarks.slice(0, 300) : landmarks
  const spacings = sample.map((l) => nearestNeighbour(l, landmarks)).sort((a, b) => a - b)
  const medianSpacingM = spacings.length
    ? Math.round(spacings[Math.floor(spacings.length / 2)])
    : 0

  let questionsWritten = 0
  let questionsPlaceScoped = 0
  for (const l of landmarks) {
    if (!l.funFact) continue
    questionsWritten++
    try {
      if ((JSON.parse(l.funFact) as { scope?: string }).scope === 'place') questionsPlaceScoped++
    } catch {
      // malformed rows simply don't count as place-scoped
    }
  }

  return {
    total: n,
    byCategory,
    byTier,
    grounding,
    groundedShare: grounded / n,
    withWikipedia,
    oldest,
    walkBands,
    medianSpacingM,
    questionsWritten,
    questionsPlaceScoped,
  }
}
