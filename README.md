# SEEN

**Claim a place with a photo. The place keeps every photo, forever.**

Real landmarks near the venue appear as pins on a live map. Stand at one, take a single photo, and it's yours for three hours — until someone takes it back. But the claim is the *game*; the photo is the *artifact*. Every photograph ever accepted joins that place's permanent archive, and its pixels feed a live, measured answer to a strange question: **what colour is this neighbourhood right now?**

Made at SummerHacks '26, Toronto.

## The transformation

A claim passes through three independent checks, strictest-first:

1. **You are where you say you are** — the server recomputes the haversine distance from your reported GPS fix to the landmark; client claims of "in range" are never trusted.
2. **The photo is new** — a perceptual hash (dHash over a 9×8 luma grid) is compared against every photo ever accepted at that landmark; a re-upload or light re-edit collides and is refused. Deterministic and explainable.
3. **The photo shows the place** *(optional layer)* — Claude vision, given the landmark's name and OSM metadata, judges plausibility. No key configured? The system degrades to the two deterministic checks and logs the attempt as unverified. The demo never hinges on an external API.

Every attempt — pass or fail — is logged with its reason, which is where the dashboard's verification telemetry comes from.

Then the part that outlives the game: the photo's dominant palette, brightness, saturation and sky fraction are extracted (arithmetic over pixels, no model), stored forever, and blended into the neighbourhood's live colour — sliceable by hour and by place on the public dashboard.

## Pages

- `/` — the map. Tap a pin: who holds it, its permanent photo archive, its own blended colour, a **Walk me there** walking route (OSRM, with a straight-line fallback).
- `/dashboard.html` — the colour of the neighbourhood: live palette, the day hour by hour, verification telemetry, claims over time, standings, extremes. Everything recomputed from real data on every update.
- `/api/state` — the raw dataset, public.

## Run it

```bash
npm install
npm run seed   # pulls real landmarks near the venue from OpenStreetMap
npm run dev    # map on :5173, server on :8787
```

**Before the event:** set `VENUE` in `shared/config.ts` to the actual venue coordinates, delete `data/`, and reseed. The venue itself is a claimable tier-3 landmark with a generous indoor radius — that's the judge-demo moment.

**Deploy:** the included `Dockerfile` and `render.yaml` deploy in a few minutes on Render's free tier. HTTPS is required — browsers only expose camera and precise geolocation on secure origins. Mount the disk at `/app/data` or the archive resets on redeploy.

`ANTHROPIC_API_KEY` (optional) enables vision verification. Drop Reve-generated brand assets in `web/public/brand/` (`mark.svg` replaces the wordmark automatically).

## Privacy

Identity is a chosen handle in `localStorage` — no accounts, no email. Location is used to verify a claim and never stored beyond the distance figure. Country-free, IP-free. Photos are public by design; that's the artifact.

## Stack

Vanilla TypeScript. MapLibre GL with OpenFreeMap tiles (no key), Node + `ws` + `node:sqlite`, photos on disk. No framework, no ORM, no external services on the critical path.
