// Batch-generates one fun-fact MCQ per landmark, offline, once.
// Run after seeding, with ANTHROPIC_API_KEY set:  npx tsx server/funfacts.ts
//
// Honesty rule baked into the prompt: for obscure places with no description,
// the question must be about the *category* (murals, memorials, fountains in
// general), never an invented specific "fact" about that exact spot.

import './env' // must stay first — see server/env.ts
import { allLandmarks, setFunFact } from './db'

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? ''
const OPENAI_KEY = process.env.OPENAI_API_KEY ?? ''
const ANTHROPIC_MODEL = process.env.FUNFACT_MODEL ?? 'claude-sonnet-5'
const OPENAI_MODEL = process.env.OPENAI_FUNFACT_MODEL ?? 'gpt-4o-mini'

interface FunFact {
  question: string
  options: string[]
  correctIndex: number
}

const SYSTEM =
  'You write short, fun, surprising multiple-choice trivia for a city-exploration game. ' +
  'For well-documented places, use real knowledge. For obscure or generic places, ask about ' +
  'the CATEGORY in general (how murals get commissioned, why memorials face the way they do) — ' +
  'never invent a specific fact about the exact spot. Keep it light. Reply with JSON only.'

async function generate(name: string, category: string, description: string | null): Promise<FunFact | null> {
  const prompt =
    `Place: "${name}". Category: ${category}.` +
    (description ? ` Description: ${description}.` : ' No description available.') +
    '\nReturn ONLY {"question":"...","options":["...","...","...","..."],"correctIndex":0}'

  let text = ''
  if (OPENAI_KEY) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${OPENAI_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        max_tokens: 300,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: prompt },
        ],
      }),
    })
    if (!res.ok) {
      console.warn(`  ! openai ${res.status} for "${name}"`)
      return null
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    text = body.choices?.[0]?.message?.content ?? ''
  } else {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 300,
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) {
      console.warn(`  ! anthropic ${res.status} for "${name}"`)
      return null
    }
    const body = (await res.json()) as { content?: { type: string; text?: string }[] }
    text = body.content?.find((c) => c.type === 'text')?.text ?? ''
  }
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const f = JSON.parse(m[0]) as FunFact
    if (!f.question || !Array.isArray(f.options) || f.options.length < 3) return null
    f.correctIndex = Math.max(0, Math.min(f.options.length - 1, Number(f.correctIndex) || 0))
    return f
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  if (!OPENAI_KEY && !ANTHROPIC_KEY) {
    console.log('[funfacts] no OPENAI_API_KEY or ANTHROPIC_API_KEY — skipping (the app works fine without them)')
    process.exit(0)
  }
  const todo = allLandmarks().filter((l) => !l.funFact)
  console.log(`[funfacts] generating for ${todo.length} landmarks…`)
  let done = 0
  for (const l of todo) {
    const f = await generate(l.name, l.category, l.description)
    if (f) {
      setFunFact(l.id, JSON.stringify(f))
      done++
      console.log(`  ✓ ${l.name}`)
    }
    await new Promise((r) => setTimeout(r, 300)) // gentle pacing
  }
  console.log(`[funfacts] ${done}/${todo.length} written`)
  process.exit(0)
}

void main()
