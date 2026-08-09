// Generates one question per landmark, offline, once.
//   npm run funfacts              every landmark without a question
//   npm run funfacts -- --gated   only the trivia-gated ones (tier 3)
//   npm run funfacts -- --limit 50
//
// Runs on Claude, falling back to Gemini if Claude is unavailable or fails.
//
// Every landmark gets a question — engagement is the point — but not every
// landmark deserves the same KIND of question, and that distinction is the whole
// design.
//
// Where real material exists (a Wikipedia extract, an inscription, an artist, a
// date, a material), the question is about that exact spot, built from facts
// kept verbatim at seed time. Where the record is just a name and a category —
// about a quarter of them — asking something specific would mean inventing it,
// and a fabricated "fun fact" pinned to a real place is the one output this
// project must never ship. Those get an honest question about the category
// instead: how murals get commissioned, why memorials face the way they do.
//
// The scope travels with the question so the UI can label a general one as
// general. Nothing ever poses as local knowledge it does not have.

import './env' // must stay first — see server/env.ts
import { CFG, VENUE } from '../shared/config'
import { haversineM } from '../shared/geo'
import type { Landmark } from '../shared/types'
import { allLandmarks, setFunFact } from './db'
import { askJSON, providers } from './llm'

const CLAUDE_MODEL = (): string => process.env.FUNFACT_MODEL ?? 'claude-opus-5'
const GEMINI_MODEL = (): string => process.env.GEMINI_FUNFACT_MODEL ?? 'gemini-2.5-flash'

/** Gemini's free tier allows 20 requests/minute; 3.2s between calls sits just
 *  under it. Override with FUNFACT_PACE_MS on a paid key. */
const PACE_MS = Number(process.env.FUNFACT_PACE_MS ?? 3200)

interface FunFact {
  question: string
  options: string[]
  correctIndex: number
  /** 'place' = about this exact spot; 'category' = about this kind of thing.
   *  Surfaced in the UI so a general question never poses as a local fact. */
  scope: 'place' | 'category'
}

const SYSTEM =
  'You write one short, surprising multiple-choice question for a city-exploration game, to be read ' +
  'by someone standing at the place. Every place gets a question. Choose its scope honestly.\n\n' +
  'scope "place" — use this whenever the supplied facts contain anything specific: a Wikipedia ' +
  'extract, an inscription, an artist, a date, a height, a material, an architect. Build the question ' +
  'from that material and put the exact supplying fact in sourceFact. Prefer this scope; it is the ' +
  'more interesting question.\n\n' +
  'scope "category" — use this only when the facts really are just a name and a generic category. ' +
  'Then ask something genuinely true and interesting about that KIND of thing: how murals get ' +
  'commissioned, why war memorials face east, what a "parkette" legally is, why fountains were ' +
  'originally built. Teach the player something real about the category. Leave sourceFact empty.\n\n' +
  'The one unbreakable rule: never invent a specific claim about this exact spot. If you do not know ' +
  'who painted this mural or what year it went up, do not guess — ask a category question instead. A ' +
  'plausible-sounding fabrication attached to a real place is the worst possible output.\n\n' +
  'Four options, one correct, three plausible but clearly wrong to someone paying attention. Keep the ' +
  'question under 25 words.'

/** What the model must return. Enforced by the API, not by a regex on prose. */
const SCHEMA = {
  type: 'object',
  properties: {
    scope: {
      type: 'string',
      enum: ['place', 'category'],
      description:
        '"place" if the question is about this exact spot, built from the supplied facts. "category" if it is about this kind of thing in general because no specific facts were supplied.',
    },
    sourceFact: {
      type: 'string',
      description:
        'The exact supplied fact the correct answer comes from. Empty string when scope is "category".',
    },
    question: { type: 'string' },
    options: { type: 'array', items: { type: 'string' } },
    correctIndex: { type: 'integer' },
  },
  required: ['scope', 'sourceFact', 'question', 'options', 'correctIndex'],
  additionalProperties: false,
} as const

/** The opening paragraph of a landmark's Wikipedia article, when it has one. */
async function wikiExtract(tag: string): Promise<string | null> {
  // OSM stores this as "en:CN Tower" — language prefix, then article title.
  const m = /^([a-z-]+):(.+)$/.exec(tag.trim())
  const lang = m ? m[1] : 'en'
  const title = m ? m[2] : tag.trim()
  try {
    const res = await fetch(
      `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { headers: { 'user-agent': 'SEEN/1.0 (hackathon project; contact via github)' } },
    )
    if (!res.ok) return null
    const body = (await res.json()) as { extract?: string }
    return body.extract ? body.extract.slice(0, 1500) : null
  } catch {
    return null
  }
}

/** Everything true we know about this place, as plain lines. */
async function groundingFor(l: Landmark): Promise<string> {
  const lines: string[] = [`Name: ${l.name}`, `Category: ${l.category}`]
  if (l.description) lines.push(`Description: ${l.description}`)

  let tags: Record<string, string> = {}
  try {
    tags = l.osmFacts ? (JSON.parse(l.osmFacts) as Record<string, string>) : {}
  } catch {
    tags = {}
  }
  for (const [k, v] of Object.entries(tags)) {
    if (k === 'wikipedia' || k === 'wikidata') continue
    lines.push(`OpenStreetMap ${k}: ${v}`)
  }

  if (tags.wikipedia) {
    const extract = await wikiExtract(tags.wikipedia)
    if (extract) lines.push(`Wikipedia: ${extract}`)
  }

  return lines.join('\n')
}

interface Result {
  scope: 'place' | 'category'
  sourceFact: string
  question: string
  options: string[]
  correctIndex: number
}

/** Separated from a skip on purpose: "the model had nothing to work with" and
 *  "no provider answered" look identical in the output but mean opposite things
 *  — one is the honesty rule working, the other is a broken run. */
type Outcome =
  | { kind: 'written'; fact: FunFact }
  | { kind: 'skipped' }
  | { kind: 'unavailable' }

async function generate(l: Landmark, grounding: string): Promise<Outcome> {
  const { data: out } = await askJSON<Result>({
    system: SYSTEM,
    text: `Here is everything known about this place:\n\n${grounding}`,
    schema: SCHEMA,
    maxTokens: 1000,
    claudeModel: CLAUDE_MODEL(),
    geminiModel: GEMINI_MODEL(),
    timeoutMs: 30_000,
  })
  if (!out) return { kind: 'unavailable' }

  if (!out.question || !Array.isArray(out.options) || out.options.length < 3) return { kind: 'skipped' }
  if (!out.options.every((o) => typeof o === 'string' && o.length > 0)) return { kind: 'skipped' }
  const i = Number(out.correctIndex)
  if (!Number.isInteger(i) || i < 0 || i >= out.options.length) return { kind: 'skipped' }
  const scope = out.scope === 'place' ? 'place' : 'category'

  return {
    kind: 'written',
    fact: { question: out.question, options: out.options, correctIndex: i, scope },
  }
}

async function main(): Promise<void> {
  const have = providers()
  if (have.length === 0) {
    console.log(
      '[funfacts] no ANTHROPIC_API_KEY or GEMINI_API_KEY — skipping (the app works fine without them)',
    )
    process.exit(0)
  }

  const gatedOnly = process.argv.includes('--gated')
  const limitArg = process.argv.indexOf('--limit')
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity

  // Gated tiers first — there the question is the claim gate, not flavour, so an
  // interrupted run leaves those covered. Then nearest the venue, because with
  // 4000 landmarks and a rate limit you will not finish, and the ones within
  // walking distance are the only ones anyone can reach today.
  const todo = allLandmarks()
    .filter((l) => !l.funFact)
    .filter((l) => !gatedOnly || l.tier >= CFG.triviaGateMinTier)
    .sort(
      (a, b) =>
        b.tier - a.tier ||
        haversineM(VENUE.lat, VENUE.lng, a.lat, a.lng) -
          haversineM(VENUE.lat, VENUE.lng, b.lat, b.lng),
    )
    .slice(0, Number.isFinite(limit) ? limit : undefined)

  const gated = todo.filter((l) => l.tier >= CFG.triviaGateMinTier).length
  const chain = have.map((p) => (p === 'claude' ? CLAUDE_MODEL() : GEMINI_MODEL())).join(' → ')
  console.log(`[funfacts] ${todo.length} landmarks to try (${gated} gated) · ${chain}`)

  let place = 0
  let category = 0
  let skipped = 0
  let unavailable = 0
  for (const l of todo) {
    const grounding = await groundingFor(l)
    const out = await generate(l, grounding)
    if (out.kind === 'written') {
      setFunFact(l.id, JSON.stringify(out.fact))
      if (out.fact.scope === 'place') place++
      else category++
      const mark = out.fact.scope === 'place' ? '✓' : '~'
      console.log(`  ${mark} ${l.name} — ${out.fact.question}`)
    } else if (out.kind === 'skipped') {
      skipped++
      console.log(`  · ${l.name} — nothing specific enough, left without a question`)
    } else {
      unavailable++
      console.log(`  ! ${l.name} — no provider answered, not attempted`)
    }
    // Free tier is 20 requests/minute. Pace under it deliberately — the retry
    // in llm.ts is a safety net, not a strategy, and a run that trips the limit
    // on every call takes far longer than one that never trips it.
    await new Promise((r) => setTimeout(r, PACE_MS))
  }

  console.log(
    `[funfacts] ${place + category} written — ${place} about the place itself, ${category} about its kind` +
      (skipped ? ` · ${skipped} malformed` : '') +
      (unavailable ? ` · ${unavailable} not attempted (no provider answered)` : ''),
  )
  process.exit(0)
}

void main()
