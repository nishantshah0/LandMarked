// Generates one question per landmark, offline, once.
//   npm run funfacts              every landmark without a question
//   npm run funfacts -- --gated   only the trivia-gated ones (tier 3)
//   npm run funfacts -- --limit 50
//
// Runs on Claude, falling back to Gemini if Claude is unavailable or fails.
//
// The whole design here is about specificity without invention. A question like
// "what are murals usually made of?" is filler — it could be asked at any of the
// 300 pins. But a *specific* question about an obscure mural is worse: there is
// nothing to base it on, so the model would make one up, and a wrong "fun fact"
// attached to a real place is the one output this project cannot ship.
//
// So the question is grounded rather than guessed. Two sources, both real:
//   1. the OSM tags kept verbatim at seed time (inscription, artist, dates,
//      material, architect, heritage status — see FACT_TAGS in seed.ts);
//   2. for landmarks carrying a `wikipedia` tag, the article's opening extract.
//
// The model is given that grounding, told to build the question from it, and
// told to return grounded:false rather than invent anything when the grounding
// is too thin. A skipped landmark simply has no quiz — and because the gate
// fails open, a skipped tier-3 landmark is claimable without one.

import './env' // must stay first — see server/env.ts
import { CFG } from '../shared/config'
import type { Landmark } from '../shared/types'
import { allLandmarks, setFunFact } from './db'
import { askJSON, providers } from './llm'

const CLAUDE_MODEL = (): string => process.env.FUNFACT_MODEL ?? 'claude-opus-5'
const GEMINI_MODEL = (): string => process.env.GEMINI_FUNFACT_MODEL ?? 'gemini-2.5-flash'

interface FunFact {
  question: string
  options: string[]
  correctIndex: number
}

const SYSTEM =
  'You write one multiple-choice question about a specific real place, for a city-exploration game. ' +
  'The question must be about THIS place in particular — its own history, its maker, its materials, ' +
  'its dates, what its inscription says, what it commemorates. A question that would read the same at ' +
  'any other park, mural or memorial is a failure.\n\n' +
  'Build the question only from the supplied facts. You may use well-known outside knowledge about ' +
  'famous landmarks, but never invent a specific claim about an obscure one.\n\n' +
  'A Wikipedia extract, an inscription, an artist, a date, a height or a material is ample grounding — ' +
  'when any of those is supplied, set grounded to true and build the question from it.\n\n' +
  'Set grounded to false only when the facts really are just a name and a generic category, with no ' +
  'specific detail to ask about. That is common and returning nothing is the right answer there; a ' +
  'plausible-sounding invented fact is the worst possible outcome.\n\n' +
  'When grounded: four options, one correct, three plausible but clearly wrong to someone standing ' +
  'there. Put the exact supplying fact in sourceFact.'

/** What the model must return. Enforced by the API, not by a regex on prose. */
const SCHEMA = {
  type: 'object',
  properties: {
    grounded: {
      type: 'boolean',
      description:
        'True only if the supplied facts contain something specific enough to build a question on. False if you would have to invent anything.',
    },
    sourceFact: {
      type: 'string',
      description:
        'The exact fact from the supplied material that the correct answer comes from. Empty string when grounded is false.',
    },
    question: { type: 'string' },
    options: { type: 'array', items: { type: 'string' } },
    correctIndex: { type: 'integer' },
  },
  required: ['grounded', 'sourceFact', 'question', 'options', 'correctIndex'],
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
  grounded: boolean
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

  if (!out.grounded) return { kind: 'skipped' }
  if (!out.question || !Array.isArray(out.options) || out.options.length < 3) return { kind: 'skipped' }
  if (!out.options.every((o) => typeof o === 'string' && o.length > 0)) return { kind: 'skipped' }
  const i = Number(out.correctIndex)
  if (!Number.isInteger(i) || i < 0 || i >= out.options.length) return { kind: 'skipped' }

  return { kind: 'written', fact: { question: out.question, options: out.options, correctIndex: i } }
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

  // Tier 3 first: there the question is the claim gate, not flavour, so if this
  // run is interrupted the gated places are the ones already covered.
  const todo = allLandmarks()
    .filter((l) => !l.funFact)
    .filter((l) => !gatedOnly || l.tier >= CFG.triviaGateMinTier)
    .sort((a, b) => b.tier - a.tier)
    .slice(0, Number.isFinite(limit) ? limit : undefined)

  const gated = todo.filter((l) => l.tier >= CFG.triviaGateMinTier).length
  const chain = have.map((p) => (p === 'claude' ? CLAUDE_MODEL() : GEMINI_MODEL())).join(' → ')
  console.log(`[funfacts] ${todo.length} landmarks to try (${gated} gated) · ${chain}`)

  let written = 0
  let skipped = 0
  let unavailable = 0
  for (const l of todo) {
    const grounding = await groundingFor(l)
    const out = await generate(l, grounding)
    if (out.kind === 'written') {
      setFunFact(l.id, JSON.stringify(out.fact))
      written++
      console.log(`  ✓ ${l.name} — ${out.fact.question}`)
    } else if (out.kind === 'skipped') {
      skipped++
      console.log(`  · ${l.name} — nothing specific enough, left without a question`)
    } else {
      unavailable++
      console.log(`  ! ${l.name} — no provider answered, not attempted`)
    }
    await new Promise((r) => setTimeout(r, 250)) // gentle pacing
  }

  console.log(
    `[funfacts] ${written} written · ${skipped} skipped as too thin to ask about honestly` +
      (unavailable ? ` · ${unavailable} not attempted (no provider answered)` : ''),
  )
  process.exit(0)
}

void main()
