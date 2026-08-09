// Register a finished 3D model against a place, or export its photo bundle.
//
//   npm run splat -- --list                       what has a model, what could
//   npm run splat -- --export <landmarkId>        write <id>-photos.zip here
//   npm run splat -- <landmarkId> ./model.ply     register a local file
//   npm run splat -- <landmarkId> https://…/m.spz register a remote one
//
// This is the manual half of the pipeline in server/splatgen.ts, and the one
// that actually runs today given Luma's Capture API is discontinued: export the
// zip, reconstruct it in Luma's web app / Polycam / Postshot, register the
// result here. The app then serves and renders it exactly as if a configured
// generator had produced it.

import { writeFileSync } from 'node:fs'
import { CFG } from '../shared/config'
import { loadEnv } from '../shared/env'
import { allLandmarks, allPhotos } from './db'
import { SPLAT_EXTS, bundlePhotos, registerSplat } from './splatgen'

loadEnv()

function photosFor(id: string): { id: string; takenAt: number }[] {
  return allPhotos().filter((p) => p.landmarkId === id)
}

function list(): void {
  const landmarks = allLandmarks()
  const all = allPhotos()
  const rows = landmarks
    .map((l) => ({ l, n: all.filter((p) => p.landmarkId === l.id).length }))
    .filter((r) => r.n > 0 || r.l.splatState === 'ready')
    .sort((a, b) => b.n - a.n)

  if (rows.length === 0) {
    console.log('No photographs yet — nothing to reconstruct.')
    return
  }
  console.log(`\n  photos  model     place                          (need ${CFG.splatMinPhotos})`)
  console.log('  ' + '─'.repeat(66))
  for (const { l, n } of rows) {
    const mark = l.splatState === 'ready' ? '✓ ready ' : n >= CFG.splatMinPhotos ? '· ready to build' : '· —     '
    console.log(`  ${String(n).padStart(6)}  ${mark.padEnd(8)}  ${l.name}  [${l.id}]`)
  }
  console.log()
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.length === 0 || args[0] === '--list') {
    list()
    process.exit(0)
  }

  if (args[0] === '--export') {
    const id = args[1]
    const l = allLandmarks().find((x) => x.id === id)
    if (!l) {
      console.error(`No landmark with id "${id}". Run with --list to see them.`)
      process.exit(1)
    }
    const shots = photosFor(id)
    if (shots.length === 0) {
      console.error(`"${l.name}" has no photographs yet.`)
      process.exit(1)
    }
    const out = `${id.replace(/[^a-z0-9]/gi, '')}-photos.zip`
    writeFileSync(out, bundlePhotos(shots))
    console.log(`Wrote ${out} — ${shots.length} photographs of "${l.name}".`)
    if (shots.length < CFG.splatMinPhotos) {
      console.log(
        `Note: ${shots.length} photos is thin for structure-from-motion; ${CFG.splatMinPhotos}+ from varied angles solves far better.`,
      )
    }
    console.log('Reconstruct it, then: npm run splat -- ' + id + ' ./model.ply')
    process.exit(0)
  }

  const [id, model] = args
  if (!id || !model) {
    console.error('Usage: npm run splat -- <landmarkId> <file-or-url>   (--list, --export <id>)')
    process.exit(1)
  }
  const l = allLandmarks().find((x) => x.id === id)
  if (!l) {
    console.error(`No landmark with id "${id}". Run with --list to see them.`)
    process.exit(1)
  }

  const shots = photosFor(id)
  const out = await registerSplat(id, model, shots.length)
  if (!out.ok) {
    console.error(`✗ ${out.message}`)
    console.error(`  Supported: ${SPLAT_EXTS.join(', ')}`)
    process.exit(1)
  }
  console.log(`✓ "${l.name}" now has a 3D model. ${out.message}`)
  console.log(`  Reconstructed from ${shots.length} photographs. Restart the server to publish it.`)
  process.exit(0)
}

void main()
