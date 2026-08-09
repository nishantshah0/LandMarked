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

## Iconic places are harder to take

Tier-3 landmarks are **trivia-gated**: the camera will not open until you answer that place's question. Two details make it a real mechanic rather than a UI flourish:

- a gated landmark **never sends its answer to the browser** — it ships the question and options only, and the server grades the submission;
- the claim endpoint **re-checks the answer independently**, so skipping the modal and posting straight to `/api/claim` fails the same way.

It fails open by design: a landmark with no question is simply not gated, so a skipped `npm run funfacts` can never make a place unclaimable. The venue's question is hand-written in `shared/config.ts` and backfilled at boot, because that is the one gate the live demo depends on.

Questions are **grounded, never invented**. The seed keeps a whitelist of OSM tags verbatim — inscription, artist, dates, material, architect, heritage status — and for landmarks carrying a `wikipedia` tag the generator also pulls the article's opening extract. The model builds the question from that material and returns `grounded: false` rather than invent anything when the grounding is thin, so a mural with nothing but a name gets no quiz instead of a plausible-sounding fabrication. 3,165 of the 4,235 landmarks carry facts; 330 have a Wikipedia article behind them.

## Pages

- `/` — the map, covering the whole GTA. Zoomed out it draws clustered counts (tap one to dive in); from street zoom it draws individual pins, and only the ones inside your viewport. Tap a pin: who holds it, its permanent photo archive, its own blended colour, a **Walk me there** walking route (OSRM, with a straight-line fallback).

  The socket sends a deliberately thin per-pin payload — 131 bytes each, 543 KB for all 4,235 — because the full landmark record is roughly three times that and the map reads almost none of it. Sheets fetch their own detail from `/api/landmark/:id`; `/api/state` stays the fat public dataset.
- `/dashboard.html` — the colour of the neighbourhood: live palette, the day hour by hour, verification telemetry, claims over time, standings, extremes. Everything recomputed from real data on every update.
- `/api/state` — the raw dataset, public.

## Run it

```bash
npm install
cp .env.example .env   # every key in it is optional
npm run seed           # pulls real landmarks near the venue from OpenStreetMap
npm run funfacts       # optional: questions per landmark (gated tiers first)
#   npm run seed -- --force     re-pull and widen, keeping photos and claims
#   npm run funfacts -- --gated only the tier-3 landmarks that need a gate
npm run dev            # map on :5173, server on :8787
```

**Before the event:** set `VENUE` in `shared/config.ts` to the actual venue coordinates, delete `data/`, and reseed. The venue itself is a claimable tier-3 landmark with a generous indoor radius — that's the judge-demo moment.

**Deploy:** the included `Dockerfile` and `render.yaml` stand it up on Render. HTTPS is required and automatic — browsers only expose camera and precise geolocation on secure origins.

The blueprint uses the **Starter** plan (~$7/mo, cancellable) because it is the cheapest plan with a **persistent disk**, mounted at `/app/data`. Free has no disk, so the photo archive would reset on every restart and spin-down — and a permanent archive is the whole premise here, not a nice-to-have.

Landmarks are independent of that disk: `seed/landmarks.db` is committed and baked into the image, so first boot installs all 4,235 of them in seconds and never calls Overpass. Measured on a container capped at the instance's 512 MB — **healthy in 10 s, steady at ~120 MB**. Regenerate the snapshot with `npm run snapshot` after any reseed, and commit it.

Deploying from a repo you don't own: Render's **"Public Git repository"** option takes the URL directly, needing no OAuth or collaborator rights. Blueprints need a connected provider, so set the service up in the UI instead — Docker runtime, health check `/healthz`, a 1 GB disk at `/app/data`, and the env vars listed in `render.yaml`.

Deploying from a repo you don't own: Render's **"Public Git repository"** option takes the URL directly, needing no OAuth or collaborator rights. Blueprints need a connected provider, so set the service up in the UI instead — Docker runtime, health check `/healthz`, and the env vars listed in `render.yaml`.

Keys live in `.env` (gitignored, kept out of the image by `.dockerignore`); see `.env.example` for what each one switches on. All are optional — `ANTHROPIC_API_KEY` enables vision verification and question generation, `GEMINI_API_KEY` is the fallback behind it. Drop Reve-generated brand assets in `web/public/brand/` (`mark.svg` replaces the wordmark automatically).

## Privacy

Identity is a chosen handle in `localStorage` — no accounts, no email. Location is used to verify a claim and never stored beyond the distance figure. Country-free, IP-free. Photos are public by design; that's the artifact.

## Stack

Vanilla TypeScript. MapLibre GL with OpenFreeMap tiles (no key), Node + `ws` + `node:sqlite`, photos on disk. No framework, no ORM, no external services on the critical path.
