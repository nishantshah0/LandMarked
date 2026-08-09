// Turning a place's crowd-photo archive into a 3D Gaussian Splat (§3.9).
//
// A note on why this is shaped the way it is. The plan named Luma's Capture
// API as the generator; that API was discontinued and its official client
// archived in September 2024, so there is no key that makes it work. What
// survives is the part that was always the durable half:
//
//   1. the archive is the input — every accepted photo of a place, exportable
//      as one zip, which is exactly what a photogrammetry pipeline eats;
//   2. the result is self-hosted and rendered in our own viewer, not embedded
//      from someone else's iframe.
//
// So generation is a *pluggable* step between those two. Point SPLAT_API_URL at
// any service that takes a zip of photos and gives back a splat file and the
// button in the app runs end to end. Leave it unset and the same pipeline runs
// manually: export the zip, run it through Luma's web app / Polycam / Postshot,
// then `npm run splat <id> ./model.ply`. Both paths end at the same viewer.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CFG } from '../shared/config'
import type { Landmark, SplatState } from '../shared/types'
import { DATA_DIR, setSplat } from './db'
import { makeZip } from './zip'

// Follows DATA_DIR so the labeled specimen instance keeps its own models rather
// than writing into the real archive.
const PHOTO_DIR = join(DATA_DIR, 'photos')
export const SPLAT_DIR = join(DATA_DIR, 'splats')

/** Formats Spark can render. Anything else we refuse rather than half-load. */
export const SPLAT_EXTS = ['.ply', '.spz', '.splat', '.ksplat', '.sog']

export function providerConfigured(): boolean {
  return (process.env.SPLAT_API_URL ?? '').length > 0
}

/** Every photograph of a place, as one zip — the reconstruction input. */
export function bundlePhotos(photoIds: { id: string; takenAt: number }[]): Buffer {
  const entries = []
  for (const p of photoIds) {
    const file = join(PHOTO_DIR, p.id + '.jpg')
    if (!existsSync(file)) continue
    entries.push({
      name: `${p.id}.jpg`,
      data: readFileSync(file),
      modified: new Date(p.takenAt),
    })
  }
  return makeZip(entries)
}

function extOf(url: string): string {
  const path = url.split('?')[0].toLowerCase()
  const hit = SPLAT_EXTS.find((e) => path.endsWith(e))
  return hit ?? '.ply'
}

/** Pull a finished model onto our own disk so the viewer never depends on a
 *  third party staying up. Returns the local path, or null to fall back to the
 *  remote URL. */
async function selfHost(landmarkId: string, url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    const name = `${landmarkId.replace(/[^a-z0-9]/gi, '')}${extOf(url)}`
    writeFileSync(join(SPLAT_DIR, name), buf)
    return `/splats/${name}`
  } catch (e) {
    console.warn('[splat] could not self-host model:', (e as Error).message)
    return null
  }
}

/** Record a model that already exists — the manual path, and the CLI's job. */
export async function registerSplat(
  landmarkId: string,
  urlOrPath: string,
  photoCount: number,
): Promise<{ ok: boolean; url: string | null; message: string }> {
  const isRemote = /^https?:\/\//i.test(urlOrPath)
  if (isRemote) {
    // A remote URL is one of two things. If it points at an actual model file we
    // pull it onto our own disk and render it ourselves. If it doesn't — a Luma
    // share link, say — it is somebody's hosted viewer page, so downloading it
    // would fetch HTML; store it as an embed URL and let the sheet iframe it.
    const isModelFile = SPLAT_EXTS.some((e) => urlOrPath.split('?')[0].toLowerCase().endsWith(e))
    if (!isModelFile) {
      setSplat(landmarkId, 'ready', urlOrPath, photoCount)
      return { ok: true, url: urlOrPath, message: `Embedded as a hosted capture: ${urlOrPath}` }
    }
    const local = await selfHost(landmarkId, urlOrPath)
    const url = local ?? urlOrPath
    setSplat(landmarkId, 'ready', url, photoCount)
    return {
      ok: true,
      url,
      message: local ? `Downloaded and serving from ${local}` : `Linked to ${urlOrPath}`,
    }
  }

  if (!SPLAT_EXTS.some((e) => urlOrPath.toLowerCase().endsWith(e))) {
    return { ok: false, url: null, message: `Not a splat file — expected one of ${SPLAT_EXTS.join(', ')}` }
  }
  if (!existsSync(urlOrPath)) {
    return { ok: false, url: null, message: `No such file: ${urlOrPath}` }
  }
  const name = `${landmarkId.replace(/[^a-z0-9]/gi, '')}${extOf(urlOrPath)}`
  writeFileSync(join(SPLAT_DIR, name), readFileSync(urlOrPath))
  const url = `/splats/${name}`
  setSplat(landmarkId, 'ready', url, photoCount)
  return { ok: true, url, message: `Copied into ${SPLAT_DIR}, serving from ${url}` }
}

interface CreateResponse {
  id?: string
  slug?: string
  url?: string
  status?: string
}

async function poll(id: string, key: string): Promise<string | null> {
  const base = (process.env.SPLAT_STATUS_URL ?? '') || (process.env.SPLAT_API_URL ?? '')
  const deadline = Date.now() + 20 * 60_000 // reconstruction is minutes, not seconds
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 15_000))
    try {
      const res = await fetch(`${base.replace(/\/$/, '')}/${encodeURIComponent(id)}`, {
        headers: key ? { authorization: `Bearer ${key}` } : {},
      })
      if (!res.ok) continue
      const body = (await res.json()) as CreateResponse
      if (body.url) return body.url
      if (body.status === 'failed' || body.status === 'error') return null
    } catch {
      // transient — keep polling until the deadline
    }
  }
  return null
}

/**
 * Run the whole pipeline for one landmark. Long-running by nature, so callers
 * fire it and let `onDone` broadcast the result rather than awaiting it in a
 * request handler.
 */
export async function generateSplat(
  landmark: Landmark,
  photos: { id: string; takenAt: number }[],
  onDone: (state: SplatState, url: string | null) => void,
): Promise<void> {
  const key = process.env.SPLAT_API_KEY ?? ''
  const api = process.env.SPLAT_API_URL ?? ''
  try {
    const zip = bundlePhotos(photos)
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(zip)], { type: 'application/zip' }), `${landmark.id}.zip`)
    form.append('title', landmark.name)

    const res = await fetch(api, {
      method: 'POST',
      headers: key ? { authorization: `Bearer ${key}` } : {},
      body: form,
    })
    if (!res.ok) {
      console.warn(`[splat] generator returned ${res.status}`)
      setSplat(landmark.id, 'failed', null, photos.length)
      onDone('failed', null)
      return
    }

    const body = (await res.json()) as CreateResponse
    const url = body.url ?? (body.id || body.slug ? await poll(body.id ?? body.slug!, key) : null)
    if (!url) {
      setSplat(landmark.id, 'failed', null, photos.length)
      onDone('failed', null)
      return
    }

    const local = await selfHost(landmark.id, url)
    const final = local ?? url
    setSplat(landmark.id, 'ready', final, photos.length)
    onDone('ready', final)
  } catch (e) {
    console.error('[splat] generation failed:', (e as Error).message)
    setSplat(landmark.id, 'failed', null, photos.length)
    onDone('failed', null)
  }
}

export const splatMinPhotos = CFG.splatMinPhotos
