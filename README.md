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

Questions are **grounded, never invented**. The seed keeps a whitelist of OSM tags verbatim — inscription, artist, dates, material, architect, heritage status — and for landmarks carrying a `wikipedia` tag the generator also pulls the article's opening extract. The model builds the question from that material and returns `grounded: false` rather than invent anything when the grounding is thin, so a mural with nothing but a name gets no quiz instead of a plausible-sounding fabrication. Roughly 260 of the 301 landmarks carry facts; 58 have a Wikipedia article behind them.

## The place in 3D

Two capture paths land in the same `splatUrl` field, and the sheet renders on its shape.

**Fast path — one person, ~60 seconds.** Walk a slow circle around the subject in the Luma AI phone app, copy the share URL, and attach it. The sheet embeds it inline:

```bash
npx tsx server/set-splat.ts --list
npx tsx server/set-splat.ts venue "https://lumalabs.ai/embed/…"
```

**Archive path — the model comes out of the game itself.** Every accepted photo is a photograph of one place from one angle, which is exactly the input a photogrammetry pipeline wants. Once a place crosses eight photographs the app offers to rebuild it as a **3D Gaussian Splat**, rendered in-browser at `/splat.html?id=<landmarkId>` by [Spark](https://sparkjs.dev) — the model is served from our own `data/splats/`, so the viewer depends on no CDN, iframe or third-party player.

**On generation, honestly:** the plan named Luma's Capture API, which was discontinued and its client archived in September 2024 — there is no key that makes it work. So generation is a pluggable step between the two halves that do work:

```bash
npm run splat -- --list              # what has a model, what could
npm run splat -- --export <id>       # every photo of that place, as one zip
#   → reconstruct it: Luma web app / Polycam / Postshot
npm run splat -- <id> ./model.ply    # register it; the app serves and renders it
```

Point `SPLAT_API_URL` at any service that takes a zip of photos and returns a splat file and the in-app **Build the 3D model** button runs the same pipeline end to end, streaming the result back over the same WebSocket the map uses. Formats: `.ply`, `.spz`, `.splat`, `.ksplat`, `.sog`.

## Pages

- `/` — the map. Tap a pin: who holds it, its permanent photo archive, its own blended colour, a **Walk me there** walking route (OSRM, with a straight-line fallback), and its 3D model once one exists.
- `/dashboard.html` — the colour of the neighbourhood: live palette, the day hour by hour, verification telemetry, claims over time, standings, extremes. Everything recomputed from real data on every update.
- `/splat.html?id=<landmarkId>` — a place rebuilt out of its own photographs.
- `/api/landmark/<id>/photos.zip` — that place's whole archive, as the reconstruction input.
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

**Deploy:** the included `Dockerfile` and `render.yaml` deploy in a few minutes on Render's free tier. HTTPS is required — browsers only expose camera and precise geolocation on secure origins. Mount the disk at `/app/data` or the archive resets on redeploy.

Keys live in `.env` (gitignored, kept out of the image by `.dockerignore`); see `.env.example` for what each one switches on. All are optional — `OPENAI_API_KEY` **or** `ANTHROPIC_API_KEY` enables vision verification and question generation (either provider works; OpenAI wins when both are set), and `ADMIN_TOKEN` enables registering a 3D model over HTTP. Drop Reve-generated brand assets in `web/public/brand/` (`mark.svg` replaces the wordmark automatically).

## Privacy

Identity is a chosen handle in `localStorage` — no accounts, no email. Location is used to verify a claim and never stored beyond the distance figure. Country-free, IP-free. Photos are public by design; that's the artifact.

## Stack

Vanilla TypeScript. MapLibre GL with OpenFreeMap tiles (no key), Node + `ws` + `node:sqlite`, photos on disk, a store-only ZIP writer in ~90 lines rather than an archiver dependency. Three.js + Spark on the 3D page only — it is a separate bundle, so the map never pays for it. No framework, no ORM, no external services on the critical path.
