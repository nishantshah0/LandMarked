// Loads the gitignored .env before any other module reads process.env.
// Must be the FIRST import of every entrypoint: ES module imports hoist above
// module body statements, so an inline loader runs too late for modules that
// capture env values at import time.

import { existsSync, readFileSync } from 'node:fs'

try {
  if (existsSync('.env')) {
    for (const line of readFileSync('.env', 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
    }
  }
} catch {
  // a broken .env must never stop the server
}
