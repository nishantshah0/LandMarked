// Turns a captured photo into the small numeric summary the server stores.
// Runs on the client because the pixels are already here; the server does the
// hashing, comparison and aggregation, so nothing about the *decision* is
// delegated to the browser.

import {
  isSkyPixel,
  luma,
  saturationOf,
  type PhotoAnalysis,
} from '../shared/palette'

/** Downscale to a JPEG small enough to upload quickly and to store cheaply. */
export async function shrink(file: Blob, maxEdge = 1280, quality = 0.82): Promise<string> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('no canvas context')
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  return c.toDataURL('image/jpeg', quality)
}

export async function analyse(file: Blob): Promise<PhotoAnalysis> {
  const bmp = await createImageBitmap(file)

  // 64×64 for colour work
  const N = 64
  const c = document.createElement('canvas')
  c.width = N
  c.height = N
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('no canvas context')
  ctx.drawImage(bmp, 0, 0, N, N)
  const { data } = ctx.getImageData(0, 0, N, N)

  let sumL = 0
  let sumS = 0
  let sky = 0
  let skyTotal = 0
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>()

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      sumL += luma(r, g, b)
      sumS += saturationOf(r, g, b)
      if (y < N / 3) {
        skyTotal++
        if (isSkyPixel(r, g, b)) sky++
      }
      // 5 bits per channel keeps near-identical colours together
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
      const e = buckets.get(key)
      if (e) {
        e.r += r
        e.g += g
        e.b += b
        e.n++
      } else {
        buckets.set(key, { r, g, b, n: 1 })
      }
    }
  }

  const total = N * N
  const top = [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, 5)
  const palette = top.map((e) => [e.r / e.n, e.g / e.n, e.b / e.n] as [number, number, number])
  const weights = top.map((e) => e.n / total)

  // 9×8 grayscale for the server's perceptual hash
  const g = document.createElement('canvas')
  g.width = 9
  g.height = 8
  const gctx = g.getContext('2d', { willReadFrequently: true })
  if (!gctx) throw new Error('no canvas context')
  gctx.drawImage(bmp, 0, 0, 9, 8)
  const gd = gctx.getImageData(0, 0, 9, 8).data
  const gray: number[] = []
  for (let i = 0; i < 72; i++) {
    gray.push(Math.round(luma(gd[i * 4], gd[i * 4 + 1], gd[i * 4 + 2]) * 255))
  }

  bmp.close()

  return {
    gray,
    palette,
    weights,
    brightness: sumL / total,
    saturation: sumS / total,
    skyFraction: skyTotal ? sky / skyTotal : 0,
  }
}
