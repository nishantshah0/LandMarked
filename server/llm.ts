// One place that asks a model for JSON, with a fallback provider behind it.
//
// Claude first, Gemini if Claude is unavailable or fails. Both vision checks and
// question generation need exactly this, so the retry/parse/degrade logic lives
// here once rather than twice.
//
// Nothing here is on the critical path: every caller treats a null answer as
// "skip this layer" rather than an error, which is why a claim still works with
// no keys configured at all.

const KEY_CLAUDE = (): string => process.env.ANTHROPIC_API_KEY ?? ''
const KEY_GEMINI = (): string => process.env.GEMINI_API_KEY ?? ''

export type Provider = 'claude' | 'gemini'

export function providers(): Provider[] {
  const out: Provider[] = []
  if (KEY_CLAUDE()) out.push('claude')
  if (KEY_GEMINI()) out.push('gemini')
  return out
}

export interface JsonAsk {
  system: string
  text: string
  /** base64 JPEG — present on vision calls, absent on text-only ones */
  imageB64?: string
  /** JSON Schema. Enforced natively by Claude; a strong hint to Gemini. */
  schema: Record<string, unknown>
  maxTokens: number
  /** Claude model override, per call site */
  claudeModel: string
  /** Gemini model override, per call site */
  geminiModel: string
  timeoutMs?: number
}

/** Models drift about how they wrap JSON. Take the object whatever they do. */
function parseJson<T>(raw: string): T | null {
  if (!raw) return null
  const fenced = raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
  try {
    return JSON.parse(fenced) as T
  } catch {
    const m = fenced.match(/\{[\s\S]*\}/)
    if (!m) return null
    try {
      return JSON.parse(m[0]) as T
    } catch {
      return null
    }
  }
}

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), ms)
  try {
    return await fn(c.signal)
  } finally {
    clearTimeout(t)
  }
}

async function viaClaude(ask: JsonAsk): Promise<string> {
  const content: unknown[] = []
  if (ask.imageB64) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: ask.imageB64 },
    })
  }
  content.push({ type: 'text', text: ask.text })

  return withTimeout(ask.timeoutMs ?? 20_000, async (signal) => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'x-api-key': KEY_CLAUDE(),
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: ask.claudeModel,
        max_tokens: ask.maxTokens,
        system: ask.system,
        // Structured outputs: the API constrains the shape, so there is no
        // "reply with JSON only" plea and nothing to salvage with a regex.
        output_config: { format: { type: 'json_schema', schema: ask.schema } },
        messages: [{ role: 'user', content }],
      }),
    })
    if (!res.ok) throw new Error(`claude ${res.status}`)
    const body = (await res.json()) as {
      stop_reason?: string
      content?: { type: string; text?: string }[]
    }
    // Safety classifiers can decline with a 200; that is not a usable answer.
    if (body.stop_reason === 'refusal') throw new Error('claude refused')
    return body.content?.find((c) => c.type === 'text')?.text ?? ''
  })
}

/** Gemini's responseSchema is an OpenAPI 3.0 subset and rejects a few JSON
 *  Schema keywords we use. Strip just those, rather than dropping the schema —
 *  an unbound model invents its own field names (it answered a perfectly good
 *  question with "answer": "..." instead of the "correctIndex" we asked for,
 *  and the result was thrown away as malformed). */
function toGeminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toGeminiSchema)
  if (!node || typeof node !== 'object') return node
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === 'additionalProperties') continue
    out[k] = toGeminiSchema(v)
  }
  return out
}

async function viaGemini(ask: JsonAsk): Promise<string> {
  const parts: unknown[] = [{ text: ask.text }]
  if (ask.imageB64) {
    parts.unshift({ inline_data: { mime_type: 'image/jpeg', data: ask.imageB64 } })
  }

  return withTimeout(ask.timeoutMs ?? 20_000, async (signal) => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        ask.geminiModel,
      )}:generateContent`,
      {
        method: 'POST',
        signal,
        headers: { 'x-goog-api-key': KEY_GEMINI(), 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: ask.system }] },
          contents: [{ role: 'user', parts }],
          // Gemini's responseSchema rejects some JSON Schema keywords we use
          // (additionalProperties among them), so ask for JSON and let the
          // caller's validation be the contract. Callers already validate
          // strictly, because a model can always return well-formed nonsense.
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: toGeminiSchema(ask.schema),
            // Gemini 2.5 counts *thinking* against maxOutputTokens, and on a
            // long grounding blob the thoughts alone can run several hundred
            // tokens — enough to leave no room for the answer and return an
            // empty candidate. Callers size maxTokens for the answer, so give
            // the reasoning its own headroom rather than making every call site
            // guess at it.
            maxOutputTokens: ask.maxTokens * 3,
          },
        }),
      },
    )
    if (!res.ok) throw new Error(`gemini ${res.status}`)
    const body = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[]
    }
    return body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  })
}

/**
 * Ask for a JSON object. Returns the first provider that answers with something
 * parseable, or null if none does — never throws.
 */
export async function askJSON<T>(ask: JsonAsk): Promise<{ data: T | null; provider: Provider | null }> {
  const attempts: [Provider, () => Promise<string>][] = []
  if (KEY_CLAUDE()) attempts.push(['claude', () => viaClaude(ask)])
  if (KEY_GEMINI()) attempts.push(['gemini', () => viaGemini(ask)])

  for (const [provider, run] of attempts) {
    try {
      const data = parseJson<T>(await run())
      if (data) return { data, provider }
      console.warn(`[llm] ${provider} returned nothing parseable`)
    } catch (e) {
      console.warn(`[llm] ${provider} failed: ${(e as Error).message}`)
    }
  }
  return { data: null, provider: null }
}
