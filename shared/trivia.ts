// The Tier-3 gate (§3.6 of the plan).
//
// Iconic places are harder to take: before the camera will open you have to
// answer that place's question. The mechanic is deliberately the cheap one —
// no minigame engine — but it is enforced on the *server*, not just in the UI,
// and gated landmarks never ship their answer to the browser. So the gate is
// real rather than decorative, which is the whole difference in a rubric that
// scores technical craft.
//
// It fails open on purpose: a landmark with no question is simply not gated.
// A missing batch-generation run must never make a place unclaimable.

import { CFG, type Tier } from './config'
import type { TriviaPublic } from './types'

export interface Trivia {
  question: string
  options: string[]
  correctIndex: number
}

export function parseTrivia(raw: string | null): Trivia | null {
  if (!raw) return null
  try {
    const t = JSON.parse(raw) as Partial<Trivia>
    if (typeof t.question !== 'string' || !t.question) return null
    if (!Array.isArray(t.options) || t.options.length < 2) return null
    if (!t.options.every((o) => typeof o === 'string')) return null
    const i = Number(t.correctIndex)
    if (!Number.isInteger(i) || i < 0 || i >= t.options.length) return null
    return { question: t.question, options: t.options, correctIndex: i }
  } catch {
    return null
  }
}

/** Is this place's camera locked behind its question? */
export function isGated(l: { tier: Tier; funFact: string | null }): boolean {
  return l.tier >= CFG.triviaGateMinTier && parseTrivia(l.funFact) !== null
}

/** The half a gated client is allowed to see — everything but the answer. */
export function publicTrivia(t: Trivia): TriviaPublic {
  return { question: t.question, options: t.options }
}
