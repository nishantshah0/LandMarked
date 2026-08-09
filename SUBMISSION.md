# Devpost submission copy — SEEN

Fill the two URLs, then paste. **Hard deadline 1:00 PM today — submit by 12:30, not 12:59.**

- **Live site:** `<DEPLOY URL>`
- **Live dashboard:** `<DEPLOY URL>/dashboard.html`
- **Repo:** https://github.com/nishantshah0/LandMarked
- **Tracks:** Main + TECHNATION Data Intelligence *(+ Best Use of Reve if brand assets shipped)*

---

## Elevator pitch (one line)

Claim real places near you with a single photo — the place keeps every photo forever, and together they answer a strange question live: what colour is this neighbourhood right now?

## Inspiration

Location games treat your photo as a receipt: it proves you were there, then it dies in a database. We wanted the opposite — a game where the proof *is* the artifact. Every photo anyone takes joins a permanent archive of that exact place, so the record of the game slowly becomes a crowd-built visual memory of a few city blocks.

## What it does

Real landmarks around the venue — murals, memorials, fountains, parks, plaques, pulled live from OpenStreetMap — appear as pins on a shared map. Stand at one, take one photo, and you hold that place for three hours, until someone takes it back.

The claim rotates. The photograph doesn't. Every accepted photo joins that place's permanent archive — scrubbable on its pin, oldest to newest, different hours, different weather, different hands. And every photo's pixels feed the dashboard: the live blended palette of the neighbourhood, the day hour by hour, which corner is the most vivid, which is the dimmest, which sees the most sky.

Contributing takes under a minute with zero explanation: tap a glowing pin, walk (there's a built-in walking route), shoot. No account — just a handle.

## The transformation (our technical core)

**One photograph → three independent verifications → a permanent archive entry → a measurable shift in the neighbourhood's colour.**

1. **Location** — the server recomputes the haversine distance from your GPS fix to the landmark. Client claims are never trusted.
2. **Freshness** — a perceptual hash (dHash over a 9×8 luma grid) is compared against every photo ever accepted at that place; re-uploads and light edits collide and are refused. Fully deterministic, explainable in one sentence.
3. **Plausibility** — Claude vision, given the landmark's name and OSM metadata, judges whether the photo could have been taken there. Deliberately optional: if the API is down or unconfigured, the deterministic checks carry the claim and the attempt is logged unverified. The demo never hinges on someone else's uptime.

Then the part that outlives the game: dominant palette, brightness, saturation and sky-fraction are extracted from the pixels — arithmetic, no model — stored forever, and blended into the live colour of the neighbourhood.

## The data (TECHNATION)

Everything on `/dashboard.html` is recomputed from real usage on every update, over the same WebSocket the game uses:

- **The colour of the neighbourhood** — live blended palette from every photo, described in plain language, sliced hour by hour so you can watch the day turn
- **Verification telemetry** — every claim attempt is logged, pass or fail: pass rate, mean vision confidence by tier, and exactly why claims were refused. This is the system's real production accuracy, not a sample
- Claims over time, standings, most contested places, and the extremes — most vivid, dimmest, most open to the sky
- The full dataset is public at `/api/state`

Nothing is hardcoded, estimated, or seeded. When someone claims during judging, the palette moves while you watch.

## How we built it

Vanilla TypeScript end to end — no framework, no ORM. MapLibre GL with OpenFreeMap vector tiles (no API key), a single Node process with `ws` and `node:sqlite`, photos on disk, OSRM for walking routes with a straight-line fallback. Every external dependency has a failure path that keeps the game playable.

## Challenges

The best bug: our unclaimed pins had a gentle CSS pulse animating `transform` — and the pin element *is* MapLibre's marker root, whose positioning is an inline transform. The animation silently overrode it every frame and collapsed all 41 pins into a single stack at the map origin. The map looked completely broken; the fix was animating box-shadow instead. A one-line lesson about CSS cascade priority we will never forget.

Also: Overpass rejects requests without a descriptive User-Agent and its main instance rate-limits hard, so the seed walks three public mirrors; and we made claim expiry *derived* (a place's owner is just its newest non-expired claim) so there are no cron jobs and no expiry bugs — the server literally cannot disagree with itself about who holds what.

## What's next

More neighbourhoods (the seed is one bounding box away from any city), seasonal archive pages per place, and the fun-fact layer generated from each landmark's OSM history.
