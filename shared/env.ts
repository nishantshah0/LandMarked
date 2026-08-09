// Loads .env into process.env once, at startup, if the file exists.
//
// Node 20.12+ ships this natively, so there is no dotenv dependency. In
// production (Render) there is no .env file — real environment variables are
// already set — so a missing file is the normal case, never an error.
//
// Every consumer still reads process.env *lazily* (inside a function, not at
// module scope), so no import-ordering hazard can leave a key unread.

import { existsSync } from 'node:fs'

let loaded = false

export function loadEnv(): void {
  if (loaded) return
  loaded = true
  if (!existsSync('.env')) return
  try {
    process.loadEnvFile('.env')
  } catch (e) {
    console.warn('[env] could not read .env:', (e as Error).message)
  }
}

/** Trimmed env var, or '' — never undefined, so callers can just check length. */
export function env(name: string): string {
  loadEnv()
  return (process.env[name] ?? '').trim()
}
