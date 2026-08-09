// Optional second opinion on whether a photo shows the place it claims to.
//
// Deliberately optional: GPS and the perceptual-hash check are deterministic and
// run first, so the game is fully playable with no API key at all. If no key is
// configured, or every provider fails, the claim passes on the deterministic
// checks alone and the attempt is logged as unverified. A demo must never hinge
// on someone else's uptime.
//
// Claude judges first; Gemini, then OpenAI stand behind it (see server/llm.ts).

import { askJSON, providers } from './llm'

const CLAUDE_MODEL = (): string => process.env.VISION_MODEL ?? 'claude-opus-5'
const GEMINI_MODEL = (): string => process.env.GEMINI_VISION_MODEL ?? 'gemini-2.5-flash'

export const visionEnabled = (): boolean => providers().length > 0

const OPENAI_MODEL = (): string => process.env.OPENAI_VISION_MODEL ?? 'gpt-4o-mini'

/** Which provider will actually judge a claim, printed at boot — so the pitch
 *  can never drift from what is really running. (Idea carried over from the
 *  brand branch, where it guarded the same risk against a different provider
 *  pair — which is exactly the drift that happened here when the chain gained
 *  a third link.) */
export const visionProvider = (): string => {
  const have = providers()
  if (have.length === 0) return 'none'
  const model = { claude: CLAUDE_MODEL, gemini: GEMINI_MODEL, openai: OPENAI_MODEL }
  return have.map((p) => model[p]()).join(' → ')
}

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
  'for example a screenshot, a selfie indoors when the place is a park, or an obviously unrelated subject.'

const SCHEMA = {
  type: 'object',
  properties: {
    is_match: { type: 'boolean' },
    confidence: { type: 'integer', description: 'how confident, 0 to 100' },
    reasoning: { type: 'string', description: 'one short sentence' },
  },
  required: ['is_match', 'confidence', 'reasoning'],
  additionalProperties: false,
}

interface Raw {
  is_match?: boolean
  confidence?: number
  reasoning?: string
}

export async function verifyPhoto(
  jpegBase64: string,
  landmarkName: string,
  category: string,
  description: string | null,
): Promise<Verdict> {
  if (!visionEnabled()) return UNCHECKED

  const { data } = await askJSON<Raw>({
    system: SYSTEM,
    text:
      `Place: "${landmarkName}". Category: ${category}.` +
      (description ? ` Description: ${description}.` : '') +
      '\n\nCould this photo plausibly have been taken at or near this place?',
    imageB64: jpegBase64,
    schema: SCHEMA,
    maxTokens: 300,
    claudeModel: CLAUDE_MODEL(),
    geminiModel: GEMINI_MODEL(),
    openaiModel: OPENAI_MODEL(),
    timeoutMs: 12_000,
  })

  // Every provider failed — pass on the deterministic checks alone rather than
  // punish a player for someone else's outage.
  if (!data) return UNCHECKED

  return {
    checked: true,
    isMatch: data.is_match !== false,
    confidence: Math.max(0, Math.min(100, Math.round(Number(data.confidence) || 0))),
    reasoning: String(data.reasoning ?? '').slice(0, 180),
  }
}
