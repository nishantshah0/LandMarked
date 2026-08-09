// Writes seed/landmarks.db — the landmark set with the archive stripped out.
//
// The Docker image bakes this in so a deploy never calls Overpass (see
// docker-entrypoint.sh). It has to be a committed file rather than data/seen.db,
// because data/ is gitignored: the platform builds from a clean clone and would
// otherwise find nothing and fall back to a 10k-element query at boot.
//
// Photographs, claims and attempts are deleted before writing. The committed
// artifact is the *starting position* of the world, never anyone's real usage —
// which also keeps a live archive from leaking into a public repo.
//
//   npm run snapshot        after `npm run seed -- --force`

import { copyFileSync, mkdirSync, statSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const SRC = 'data/seen.db'
const OUT_DIR = 'seed'
const OUT = `${OUT_DIR}/landmarks.db`

try {
  statSync(SRC)
} catch {
  console.error(`[snapshot] ${SRC} not found — run \`npm run seed\` first`)
  process.exit(1)
}

mkdirSync(OUT_DIR, { recursive: true })
copyFileSync(SRC, OUT)

const db = new DatabaseSync(OUT)
for (const t of ['photos', 'claims', 'attempts']) {
  try {
    db.exec(`DELETE FROM ${t}`)
  } catch {
    // table may not exist on an older database
  }
}
// photo_count is a denormalised counter for the archive we just dropped.
db.exec('UPDATE landmarks SET photo_count = 0')
db.exec('VACUUM')

const n = db.prepare('SELECT COUNT(*) AS n FROM landmarks').get() as unknown as { n: number }
const q = db
  .prepare('SELECT COUNT(*) AS n FROM landmarks WHERE fun_fact IS NOT NULL')
  .get() as unknown as { n: number }
db.close()

const kb = Math.round(statSync(OUT).size / 1024)
console.log(`[snapshot] wrote ${OUT} — ${n.n} landmarks, ${q.n} with questions, ${kb} KB`)
console.log('[snapshot] commit it so the deployed image can seed itself offline')
