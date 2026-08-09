const R = 6_371_000 // metres

/** Great-circle distance. Recomputed server-side on every claim — never trust
 *  a client that says it is standing somewhere. */
export function haversineM(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const φ1 = (aLat * Math.PI) / 180
  const φ2 = (bLat * Math.PI) / 180
  const dφ = φ2 - φ1
  const dλ = ((bLng - aLng) * Math.PI) / 180
  const s =
    Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

export function fmtDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(1)} km`
}

/**
 * dHash over a 9×8 grayscale grid: each row contributes 8 bits comparing a
 * pixel to its right-hand neighbour. Robust to resizing, recompression and
 * brightness — so a re-uploaded or lightly-edited photo still collides.
 */
export function dHash(gray9x8: number[]): string {
  let bits = ''
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits += gray9x8[y * 9 + x] > gray9x8[y * 9 + x + 1] ? '1' : '0'
    }
  }
  let hex = ''
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return hex
}

export function hamming(a: string, b: string): number {
  if (a.length !== b.length) return 64
  let d = 0
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    while (x) {
      d += x & 1
      x >>= 1
    }
  }
  return d
}
