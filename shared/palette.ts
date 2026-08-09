// What a photograph is made of.
//
// The client downsamples the capture on a canvas and sends a small numeric
// summary; the server hashes, aggregates and stores it. Nothing here is a model
// call — every figure on the dashboard traces back to arithmetic over pixels,
// which is what makes it defensible when someone asks how it works.

export interface PhotoAnalysis {
  /** 9×8 grayscale grid, the input to dHash */
  gray: number[]
  /** up to 5 dominant colours, each 0-255 RGB */
  palette: [number, number, number][]
  /** share of the frame each palette entry covers, parallel to `palette` */
  weights: number[]
  brightness: number // 0..1, mean luma
  saturation: number // 0..1, mean HSV S
  skyFraction: number // 0..1, share of the upper third that is bright and blue-ish
}


export function luma(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

export function saturationOf(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

/** Bright, blue-dominant pixels in the top third read as sky. Crude, honest, explainable. */
export function isSkyPixel(r: number, g: number, b: number): boolean {
  return b > 90 && b >= g && g >= r && luma(r, g, b) > 0.42
}

export function hex(c: [number, number, number]): string {
  return '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}

/** Weighted mean of many palettes — the colour of a place, or of a whole evening. */
export function blend(
  entries: { palette: [number, number, number][]; weights: number[] }[],
): [number, number, number][] {
  // Bucket into a coarse 4×4×4 RGB cube so near-identical colours combine.
  const buckets = new Map<number, { r: number; g: number; b: number; w: number }>()
  for (const e of entries) {
    e.palette.forEach((c, i) => {
      const w = e.weights[i] ?? 0
      if (w <= 0) return
      const key = (Math.floor(c[0] / 64) << 4) | (Math.floor(c[1] / 64) << 2) | Math.floor(c[2] / 64)
      const b = buckets.get(key)
      if (b) {
        b.r += c[0] * w
        b.g += c[1] * w
        b.b += c[2] * w
        b.w += w
      } else {
        buckets.set(key, { r: c[0] * w, g: c[1] * w, b: c[2] * w, w })
      }
    })
  }
  return [...buckets.values()]
    .sort((a, b) => b.w - a.w)
    .slice(0, 6)
    .map((b) => [b.r / b.w, b.g / b.w, b.b / b.w] as [number, number, number])
}

/** A plain-language reading of an aggregate palette, for the dashboard and the Reve brief. */
export function describe(brightness: number, saturation: number, sky: number): string {
  const light = brightness < 0.32 ? 'dim' : brightness < 0.55 ? 'overcast' : 'bright'
  const colour = saturation < 0.18 ? 'nearly colourless' : saturation < 0.38 ? 'muted' : 'vivid'
  const open = sky < 0.08 ? 'closed in' : sky < 0.25 ? 'partly open' : 'wide open to the sky'
  return `${light}, ${colour}, ${open}`
}
