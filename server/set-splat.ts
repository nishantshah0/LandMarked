// Attach a real 3D reconstruction to a landmark.
//
// The capture takes one person ~60 seconds: walk a slow circle around the
// subject with the Luma AI app (free), let it process, copy the share/embed
// URL, then:
//
//   npx tsx server/set-splat.ts venue "https://lumalabs.ai/embed/…"
//
// The landmark's sheet shows the interactive model immediately (server restart
// picks it up). List landmark ids:  npx tsx server/set-splat.ts --list

import './env'
import { allLandmarks, setSplatUrl } from './db'

const [, , id, url] = process.argv

if (id === '--list' || !id) {
  for (const l of allLandmarks()) {
    console.log(`${l.id.padEnd(14)} ${l.name}${l.splatUrl ? '  [3D ✓]' : ''}`)
  }
  process.exit(0)
}

if (!url || !/^https:\/\//.test(url)) {
  console.error('usage: npx tsx server/set-splat.ts <landmarkId> <https-embed-url>   (or --list)')
  process.exit(1)
}

const lm = allLandmarks().find((l) => l.id === id)
if (!lm) {
  console.error(`unknown landmark "${id}" — run with --list`)
  process.exit(1)
}

setSplatUrl(id, url)
console.log(`[splat] "${lm.name}" now has a 3D model → restart the server to serve it`)
process.exit(0)
