# SEEN — feature list

Everything here is shipped and verifiable on the live site.

## Game
- One-photo claims: stand within 100 m, shoot once, hold the place for 3 h — no account, just a handle
- 4,235 real landmarks (murals, memorials, fountains, parks, churches, theatres) from OpenStreetMap across the Greater Toronto Area — Etobicoke to Scarborough, lakeshore to Steeles — densest around Stackt Market, where you can actually walk between them
- The map holds a whole city: clustered counts at city zoom that expand on tap, individual pins from street zoom, and only the pins in your viewport ever exist as DOM nodes
- Contested ownership: holds lapse after 3 h, pins free themselves live, points by tier
- The venue itself is a claimable tier-3 pin with an indoor-tolerant 600 m radius and a 600 m GPS-accuracy allowance — indoors a phone reports 100–500 m, and rejecting that rejects every honest judge
- "Walk me there": OSRM walking route drawn on-map with distance/ETA, straight-line fallback
- Iconic (tier-3) places are trivia-gated: the camera stays locked until you answer that place's question, the answer is never sent to the browser, and the claim endpoint re-checks it independently — the gate can't be clicked past in devtools
- Questions grounded in real material, never invented: verbatim OSM tags (inscription, artist, dates, material, architect) plus the Wikipedia extract where one exists; the generator returns "not grounded" and leaves a place without a quiz rather than fabricate a fact about it
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
- AI plausibility check — Claude, Gemini, then OpenAI behind one interface; if every provider is unreachable the claim still stands on the two deterministic checks and is logged as unverified
- Every attempt logged pass/fail with reason, distance, confidence

## Community
- /now.html — the neighbourhood's pulse: live presence ("N people looking right now", from socket counts), places gathering momentum (90-minute half-life), "start here" quest cards (nearest never-photographed places with a Wikipedia page or documented facts), today's explorers, and a QR join card that encodes whatever origin the page is served from
- The map's Now chip carries live presence

## Data (TECHNATION)
- Two real datasets on one public dashboard: the corpus (4,235 places — what kinds, which OSM tags ground them, Wikipedia coverage, oldest datable structure, median spacing) and the archive (the live neighbourhood palette and everything below)
- Hand-drawn visualizations, no chart library: the day as a 24-segment colour clock, distance-from-venue as concentric rings, the corpus as one ink-shade DNA strip — colour on screen is reserved for photographed colour
- A live claim feed that lands new rows while you watch, a geographic heatmap, verification pass rate + confidence by tier, refusal reasons, claims-over-time, standings, most contested, colour extremes
- The honesty policy as a chart: 138 place-scoped, 353 category-scoped, and 3,744 left blank — where the record had facts, and where we refused to invent them
- Raw dataset public at /api/state
- Honest empty states; nothing fabricated or hardcoded

## Infrastructure
- Public HTTPS URL for $0 (production build + Cloudflare quick tunnel, data on own disk)
- Fallback for every dependency: vision → deterministic, OSRM → straight line, Overpass → 3 mirrors, sqlite reopens on write failure
- Derived ownership (newest non-expired claim) — no cron, no expiry bugs
- Docker + Render blueprint ready for permanent hosting
- Secrets in gitignored .env, verified absent from all commits
