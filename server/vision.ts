// Optional second opinion on whether a photo shows the place it claims to.
//
// Deliberately optional: GPS and the perceptual-hash check are deterministic and
// run first, so the game is fully playable with no API key at all. If the key is
// missing or the call fails, the claim passes on the deterministic checks alone
// and the attempt is logged as unverified. A demo must never hinge on someone
// else's uptime.

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? ''
const OPENAI_KEY = process.env.OPENAI_API_KEY ?? ''
const ANTHROPIC_MODEL = process.env.VISION_MODEL ?? 'claude-sonnet-5'
const OPENAI_MODEL = process.env.OPENAI_VISION_MODEL ?? 'gpt-4o-mini'

export const visionEnabled = (): boolean => ANTHROPIC_KEY.length > 0 || OPENAI_KEY.length > 0

export interface Verdict {
  checked: boolean
  isMatch: boolean
  confidence: number
  reasoning: string
}

const UNCHECKED: Verdict = {
  checked: false,
  isMatch: true,
  confidence: 0,
  reasoning: 'vision check skipped',
}

const SYSTEM =
  'You verify whether a photograph was plausibly taken at a specific real-world place. ' +
  'Be generous: players photograph details, interiors, signage and odd angles, not postcard views. ' +
  'Reject only if the photo clearly could not have been taken at or near this place — ' +
  'for example a screenshot, a selfie indoors when the place is a park, or an obviously unrelated subject. ' +
  'Reply with JSON only.'

function question(landmarkName: string, category: string, description: string | null): string {
  return (
    `Place: "${landmarkName}". Category: ${category}.` +
    (description ? ` Description: ${description}.` : '') +
    '\n\nCould this photo plausibly have been taken at or near this place?' +
    '\nRespond ONLY with {"is_match": boolean, "confidence": 0-100, "reasoning": "one short sentence"}'
  )
}

function parseVerdict(text: string): Verdict {
  const json = text.match(/\{[\s\S]*\}/)
  if (!json) return UNCHECKED
  try {
    const parsed = JSON.parse(json[0]) as {
      is_match?: boolean
      confidence?: number
      reasoning?: string
    }
    return {
      checked: true,
      isMatch: parsed.is_match !== false,
      confidence: Math.max(0, Math.min(100, Math.round(parsed.confidence ?? 0))),
      reasoning: String(parsed.reasoning ?? '').slice(0, 180),
    }
  } catch {
    return UNCHECKED
  }
}

async function viaAnthropic(jpegBase64: string, q: string, signal: AbortSignal): Promise<Verdict> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    signal,
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 200,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpegBase64 } },
            { type: 'text', text: q },
          ],
        },
      ],
    }),
  })
  if (!res.ok) {
    console.warn(`[vision] anthropic ${res.status} — passing on deterministic checks alone`)
    return UNCHECKED
  }
  const body = (await res.json()) as { content?: { type: string; text?: string }[] }
  return parseVerdict(body.content?.find((c) => c.type === 'text')?.text ?? '')
}

async function viaOpenAI(jpegBase64: string, q: string, signal: AbortSignal): Promise<Verdict> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${OPENAI_KEY}`,
      'content-type': 'application/json',
    },
    signal,
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_tokens: 200,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'text', text: q },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${jpegBase64}` } },
          ],
        },
      ],
    }),
  })
  if (!res.ok) {
    console.warn(`[vision] openai ${res.status} — passing on deterministic checks alone`)
    return UNCHECKED
  }
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return parseVerdict(body.choices?.[0]?.message?.content ?? '')
}

export async function verifyPhoto(
  jpegBase64: string,
  landmarkName: string,
  category: string,
  description: string | null,
): Promise<Verdict> {
  if (!visionEnabled()) return UNCHECKED

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const q = question(landmarkName, category, description)
    if (OPENAI_KEY) return await viaOpenAI(jpegBase64, q, controller.signal)
    return await viaAnthropic(jpegBase64, q, controller.signal)
  } catch (e) {
    console.warn('[vision] failed:', (e as Error).message)
    return UNCHECKED
  } finally {
    clearTimeout(timeout)
  }
}
