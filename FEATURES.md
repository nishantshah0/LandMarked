# SEEN — feature list

Everything here is shipped and verifiable on the live site.

## Game
- One-photo claims: stand within 100 m, shoot once, hold the place for 3 h — no account, just a handle
- 41 real landmarks (murals, memorials, fountains, parks) from OpenStreetMap, all within a 740 m walk of Stackt Market
- Contested ownership: holds lapse after 3 h, pins free themselves live, points by tier
- The venue itself is a claimable tier-3 pin with an indoor-tolerant 250 m radius (judge demo)
- "Walk me there": OSRM walking route drawn on-map with distance/ETA, straight-line fallback
- Fun-fact quiz on all 41 pins, batch-generated with an anti-hallucination rule and an AI-flavor disclosure
- Realtime map: every claim appears on every open phone instantly (WebSocket)
- One-time intro card; zero-explanation onboarding

## Artifact
- Permanent per-place photo archives — claims rotate, archives only grow ("seen by N people")
- The colour of the neighbourhood: live blended palette + brightness/saturation/sky measured from every photo (pixel arithmetic, no model)
- Before/after reveal on success: your photo, and the neighbourhood's palette before vs after you
- Every place tinted by its own archive's colour

## Verification (the transformation)
- Server-recomputed GPS distance (client never trusted); accuracy gate with helpful errors
- Perceptual-hash (dHash) dedup vs every photo ever accepted at that place — deterministic, explainable
- AI plausibility check (OpenAI gpt-4o-mini, provider-swappable) with graceful degradation to deterministic checks
- Every attempt logged pass/fail with reason, distance, confidence

## Data (TECHNATION)
- Public live dashboard: neighbourhood palette, the day hour-by-hour, verification pass rate + confidence by tier, refusal reasons, claims-over-time, standings, most contested, colour extremes
- Raw dataset public at /api/state
- Honest empty states; nothing fabricated or hardcoded

## Infrastructure
- Public HTTPS URL for $0 (production build + Cloudflare quick tunnel, data on own disk)
- Fallback for every dependency: vision → deterministic, OSRM → straight line, Overpass → 3 mirrors, sqlite reopens on write failure
- Derived ownership (newest non-expired claim) — no cron, no expiry bugs
- Docker + Render blueprint ready for permanent hosting
- Secrets in gitignored .env, verified absent from all commits
