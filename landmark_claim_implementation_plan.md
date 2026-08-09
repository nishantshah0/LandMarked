# Landmark Claim — Implementation Plan

*A location-based photo game where players claim GTA landmarks with real-world visits and photos, and the site becomes a living, growing map of the city.*

---

## 0. Read this first: scoping against the judging criteria

You have roughly 24 hours (submission at 11:00 PM tonight, hard deadline 1:00 PM tomorrow). The judging doc scores four things — **Solution Design & Experience (30%)**, **Technical Craft (30%)**, **Originality & Creative Execution (20%)**, **Lasting Value & Community (20%)** — and there are two bonus tracks worth stacking: **Data Intelligence** (live, real, explorable usage visualizations) and **Best Use of Reve** (visual identity, not generic AI look). The Main Track also has hard constraints: input takes under 60 seconds with zero explanation, there's a real non-trivial transformation, the output is a public live artifact, and it gets better as more people contribute.

Your original idea (thousands of landmarks, CN Tower multi-person minigames, live Gaussian Splat generation, world/country leaderboards) is a fantastic *product* idea but is 2-3 weeks of work, not 24 hours. This plan keeps the exciting core — claim landmarks with photos, verified by AI vision + GPS, contested every 3 hours, live map, leaderboards, and a 3D reconstruction feature for the data track — and cuts or defers the parts that would eat your whole hackathon (see §9, "Cut List").

**Read the whole plan once before starting**, then follow §10 (build order) hour by hour. Sections 1–8 are the spec; §9–10 are the execution plan.

---

## 1. Product Concept

**Landmark Claim** is a map-based, real-world scavenger game for the Greater Toronto Area. Real landmarks (CN Tower, Casa Loma, Nathan Phillips Square, Kensington Market gates, hundreds of murals, parks, churches, historic plaques, etc.) appear as claimable pins on an interactive map. To claim a landmark, a player physically travels there, opens the camera in the app, and takes one photo. The app verifies (a) the player's GPS is within range of the landmark and (b) the photo actually shows that landmark, using AI vision. If both checks pass, the player claims the landmark for **3 hours**; it's shown as theirs with their name/avatar. After 3 hours, anyone can walk up and re-claim it. Claims are permanent history — the map fills up with a running log of who's claimed what, building a shared, ever-growing artifact of the city.

A **live dashboard** (Data Intelligence track) shows real activity: claims over time, a heatmap of where people are claiming, top landmarks by contest count, and a sentiment/flavor-text feed. A stretch feature turns the crowd-submitted photos of well-visited landmarks into a rough **3D Gaussian Splat** viewable in-browser — literally building a 3D model of Toronto out of players' claim photos over the course of the event.

---

## 2. User Flow (the 60-second onboarding requirement)

This is the most important constraint in the whole brief. A stranger must be able to open the link and understand + do the core action in under 60 seconds, unexplained.

1. Land on the site → full-screen map centered on the user's location (or downtown Toronto if GPS denied), with **pins already visibly colored** (claimed = colored/avatar, unclaimed = grey/glowing) — the map itself communicates "this is a game about places" instantly.
2. Tap a nearby pin → a card slides up: landmark name, photo, "Claimed by X · 47 min left" or "Unclaimed — be the first," and one big button: **"Claim This Spot."**
3. Tapping it (if not already at the location) prompts: "Get within 100m to claim" and shows a live distance readout that updates as they walk — turns the approach itself into part of the game.
4. Once in range, the button becomes **"Take Photo"** → opens the device camera directly (`<input capture="environment">` or `getUserMedia`) — no app install, no explanation needed.
5. Snap → short "Verifying..." animation (1-3s) → success state with confetti/animation, landmark now shows their name, timer starts, and their position moves up a leaderboard visible right there.
6. No login wall before step 5 — let people watch and explore anonymously. Require a lightweight name/handle (no email, no password) only at the moment of claiming, stored in `localStorage` + the backend, so returning is frictionless. This satisfies "zero explanation" and "under 60 seconds" simultaneously: browsing needs 0 seconds of onboarding, and the only step gated behind a name prompt is the one action that needs an identity.

This flow **is** your "one moment of input" (a photo, under 60 seconds) → "non-trivial transformation" (GPS + AI vision verification, claim logic) → "a stranger sees it" (live public map + leaderboard) → "gets better with more people" (more claims = denser, more contested, more interesting map, and a richer dashboard/3D model).

---

## 3. Core Feature Breakdown

### 3.1 Interactive Map (frontend core)

- **Library:** MapLibre GL JS (free, open-source, no API key required, vector tiles, smooth pin clustering) with a free tile source (MapTiler free tier, or Stadia Maps free tier — both give a stylable basemap with no credit card for hackathon-scale traffic). Do not use Google Maps JS — it needs billing setup and a key, which is friction you don't need right now.
- Custom pin styling: unclaimed pins pulse gently (CSS animation on a marker div) to invite curiosity; claimed pins show the claimer's avatar/initial in a colored circle with a small countdown ring that visually drains over 3 hours (SVG stroke-dashoffset tied to remaining time).
- Clustering at low zoom (MapLibre's built-in `cluster: true` on a GeoJSON source) so "thousands of landmarks" doesn't look like visual noise — clusters expand into individual pins as you zoom into a neighborhood.
- Bottom-sheet / side-panel landmark detail component (see flow above), built as a single reusable component that also powers search results and leaderboard "jump to landmark" links.
- Live updates: when *anyone* claims a landmark, all connected clients see the pin update in real time (see §3.5, realtime layer) — this is what makes the map feel alive to judges watching it during demo.

### 3.2 Landmark Data (thousands of real GTA points, zero manual entry)

Use the **OpenStreetMap Overpass API** (free, no key, no rate-limit auth) to pull real landmarks in the GTA bounding box in one query, tagged by category:

```
[out:json][timeout:60];
(
  node["tourism"~"attraction|artwork|museum|viewpoint|gallery"](43.58,-79.64,43.86,-79.12);
  node["historic"](43.58,-79.64,43.86,-79.12);
  node["amenity"~"place_of_worship|theatre|arts_centre"](43.58,-79.64,43.86,-79.12);
  node["leisure"~"park|stadium"](43.58,-79.64,43.86,-79.12);
  way["tourism"~"attraction|museum"](43.58,-79.64,43.86,-79.12);
);
out center tags;
```

This alone returns hundreds to low-thousands of named points across Toronto/Mississauga/Vaughan/Markham/etc. — real names, real coordinates, categorized. Run this **once**, offline, before the hackathon demo (not live in the app), clean/dedupe the results with a script (drop entries with no `name` tag, drop duplicates within ~15m of each other, keep the tag so you can assign difficulty tiers), and load the cleaned set into your database as a seed script. This turns "thousands of landmarks" from a data-entry problem into a 20-minute engineering task.

Assign a **tier** to each landmark at seed time based on tags/name-matching against a short manual list of major landmarks (CN Tower, Casa Loma, Nathan Phillips Square, Rogers Centre, ROM, AGO, Distillery District, etc.):

- **Tier 1 (Standard):** the vast majority — photo + GPS check only.
- **Tier 2 (Landmark):** ~15-30 well-known major sites — require a slightly larger photo confidence margin, and worth more leaderboard points.
- **Tier 3 (Iconic):** a handful (CN Tower, maybe 5-10 total) — see §3.6 for the special claim requirement.

### 3.3 Claim Verification ("visual intelligence and location data")

Two checks must both pass to award a claim:

**GPS check (cheap, instant, do this first as a gate):**
Compare the browser's `navigator.geolocation` coordinates (`enableHighAccuracy: true`) against the landmark's stored lat/lng using the Haversine formula. Require the user within a radius — start at 100m (GPS drift in dense downtown Toronto with tall buildings can be 20-50m, so don't go tighter than that) — before even allowing the camera to open. This also means you never waste an AI vision call on someone who obviously isn't there.

**Visual check (the "non-trivial transformation" judges want explained on your slide):**
Send the captured photo to **Claude's vision API** (multimodal message with an image block) with a prompt that includes the landmark's name, its OSM tags/description, and — if you have one — a reference photo, and ask it to return structured JSON: `{"is_match": true/false, "confidence": 0-100, "reasoning": "short string"}`. This is a better fit than Google Cloud Vision's landmark-detection endpoint, which is trained to recognize only globally-famous landmarks (Eiffel Tower, Taj Mahal-tier) and will not know most of your hundreds of local Toronto POIs — Claude, given the landmark's name and description as context, can reason about whether an arbitrary photo plausibly matches an arbitrary place, which is exactly your use case.

```
System: You are verifying whether a photo was taken at a specific real-world landmark.
User: [image] Landmark name: "{name}". Category: {tags}. Known description: {osm_description or none}.
Does this photo plausibly show this landmark? Respond ONLY with JSON:
{"is_match": boolean, "confidence": 0-100, "reasoning": "one sentence"}
```

Set your threshold (e.g. `is_match: true` AND `confidence >= 60`) generously for the hackathon — false rejections are a worse demo experience than false accepts, and this is a game, not a security system. Log every verification attempt (pass or fail) with the confidence score; this log is also raw material for your Data Intelligence dashboard ("verification success rate," "average confidence by landmark tier").

**Anti-cheese consideration to mention on your slide (shows technical craft judgment):** require the photo to be freshly captured (via `getUserMedia`/camera capture input, not a file picker from the gallery) so people can't submit old or downloaded photos — this is a UI-level constraint (disable "choose from library"), not something you need a backend check for, and it's worth calling out explicitly as a design decision.

### 3.4 Claim Lifecycle & Contest Timer

- On successful verification: upsert a `claims` row — `landmark_id, user_id, claimed_at, expires_at (claimed_at + 3h), photo_url, confidence`.
- A landmark's "current owner" is simply the most recent non-expired claim for that landmark (`expires_at > now()`), so you never need a cron job to "release" it — expiry is computed, not scheduled. This is a huge simplification for hackathon time: no background workers required.
- When someone attempts to claim an already-claimed, non-expired landmark, reject with a clear message and show the countdown ("Still owned by Sam for 41 more minutes").
- Every claim (expired or not) stays in the `claims` table forever — this is your permanent history / "shared growing artifact," and it's what powers "most claimed landmark," "your claim history," and the live activity feed.
- Countdown ring on the pin and detail card: compute `remaining = expires_at - now()` client-side and animate locally; don't poll the server every second, just recompute on a `setInterval` from the already-fetched `expires_at`.

### 3.5 Realtime Layer (makes the map feel alive, not just database-backed)

Use **Supabase** (Postgres + built-in Realtime + Auth-lite + Storage, generous free tier, fastest to stand up in a hackathon) as your backend:
- `landmarks` table (seeded from Overpass, see §3.2)
- `claims` table (see §3.4)
- `users` table (just a handle + optional avatar color, no password — anonymous auth or a simple localStorage-based identity is enough for a hackathon)
- Supabase Storage bucket for claim photos (public read, so photos can be shown on the map/feed and reused for the 3D reconstruction feature)
- Subscribe the frontend to Postgres changes on `claims` (Supabase Realtime channel) so every connected browser gets a live push the instant any player claims anything — this is what makes the map update in front of judges' eyes without a refresh, and is also exactly what powers a genuinely live dashboard for the Data Intelligence track.

If you don't want a backend account/service dependency at all, an alternative is **Firebase** (Firestore + Realtime listeners) — equally fast to stand up, same tradeoffs. Pick whichever teammate has used it before; don't learn a new backend platform tonight.

### 3.6 Iconic-Tier Landmarks (CN Tower-style harder claims)

Keep this **simple** given the time budget — don't build a minigame engine. For your handful of Tier 3 landmarks, add one extra requirement on top of the normal GPS+photo check, configurable per-landmark in the seed data:

- **`co_claim` requirement:** claim must be submitted by two different user handles within a 10-minute window who both pass GPS+photo — "grab a friend." Simple to implement: on a Tier-3 claim attempt, check if another *pending* Tier-3 claim exists for the same landmark within the last 10 minutes from a different user; if so, both become joint owners (store `claims.co_owner_id`, nullable). If not, store this attempt as "pending" and show "Waiting for a second person... invite a friend!" with a shareable link.
- **`trivia_gate` requirement:** before the camera opens, show one auto-generated multiple-choice question about the landmark (generate these once, offline, via Claude given the OSM description — a static JSON file, not a live API call per attempt) — get it right to unlock the camera. Cheap to build (a single component + static data), still satisfies "harder to get."

Pick **one** of these two mechanics for your Tier 3 landmarks, not both, and apply it uniformly — this keeps the code path simple and is still a compelling demo beat ("look, the CN Tower needs two people").

### 3.7 Leaderboards

Compute these as SQL queries against `claims`, not separately maintained counters — simpler and always correct:

- **Top claimers (GTA-wide):** `SELECT user_id, COUNT(*) FROM claims WHERE expires_at > now() GROUP BY user_id ORDER BY count DESC` for "current landmarks held," and a separate all-time version (no `expires_at` filter) for "most landmarks ever claimed."
- **Most contested landmark:** `SELECT landmark_id, COUNT(*) FROM claims GROUP BY landmark_id ORDER BY count DESC` — great flavor stat for the dashboard.
- **By category/tier:** same query with a `WHERE landmark.tier = X` join, for "Top CN-Tower-tier claimer" bragging rights.
- Skip true "Canada-wide" / "world" leaderboards — you only have GTA data, so a "world leaderboard" with one city's worth of data reads as padding, not a feature. If you want the *idea* of scale on the slide, frame it honestly: "GTA leaderboard live today, architecture supports any city — just re-run the Overpass seed query for a new bounding box." That's a legitimate, honest scalability story for judges without needing to fake it.

### 3.8 Data Intelligence Dashboard (bonus track)

A `/dashboard` route, publicly viewable, built from the same live Supabase Realtime subscription as the map (no separate polling system):

- **Live activity feed:** last N claims, real-time, "Sam just claimed Nathan Phillips Square 🎉" — this alone satisfies "the dashboard updates live while judges are watching."
- **Claim heatmap:** reuse MapLibre with a `heatmap` layer type over the same landmark point data, weighted by claim count — geographic visualization of where people are actually going.
- **Claims-over-time chart:** simple line/bar chart (use `recharts` if building a React dashboard) bucketed by 15-minute intervals since the event started — shows "usage over time" and, during your live demo, will visibly tick up as judges try it themselves.
- **Verification stats:** average AI-vision confidence score, pass/fail rate, split by landmark tier — this is honest, real, non-fabricated system data (exactly what judges say they're checking for) and doubles as a technical-craft talking point ("here's our AI verification accuracy in production, live").
- **Top landmarks / top players:** reuse the leaderboard queries from §3.7 as dashboard widgets.

Explicitly avoid hardcoding or screenshotting any of this — every widget should be a live query/subscription, because the rubric explicitly penalizes "fabricated or hardcoded for the demo" data.

### 3.9 3D Reconstruction Feature (stretch goal, frame honestly)

This is the most exciting differentiator but also the highest-risk item on the list — scope it as a bonus, not a dependency for your core demo, and be honest on your slide about what tier of "3D model" you're shipping.

**Reality check on the tech:** real Gaussian Splat training needs a well-overlapped set of photos of one subject taken from many angles (structure-from-motion, then splat optimization), typically processed via a cloud pipeline over minutes (e.g. Luma AI's capture/API pipeline) or a local GPU pipeline (Nerfstudio/gsplat + COLMAP). Crowdsourced claim-photos of a landmark, taken by different people, different times of day, different phones, mostly from similar "standing in front of it" angles, will **not** produce a clean walkable 3D splat in real time in a browser — that's not a hackathon problem, it's a fundamentally different capture requirement.

**What's actually buildable and still impressive:**
1. **Photo mosaic / "many angles" gallery, always ships:** for any landmark with 3+ claim photos, show a simple grid/carousel of all submitted photos on its detail page — "23 people have seen this spot" — cheap, always works, genuinely satisfies "gets better with more people" and "collect real usage data and show it back to users."
2. **On-demand splat generation for your best-covered landmark, as a live demo moment:** pick the one landmark you expect the most foot traffic/photos on during the event (e.g. wherever the hackathon venue itself is, or one central spot you seed with your own team's photos ahead of time from multiple angles). When it crosses a photo-count threshold, offer a "Generate 3D Model" button that calls the **Luma AI API** (or, more reliably given time constraints, pre-process this one landmark's photos yourself before the demo using Luma's free web app or a Polycam capture) and embed the resulting splat with a browser viewer — **SuperSplat** (PlayCanvas, MIT-licensed, embeds via a `<script>` include or iframe) or the lighter-weight **@sparkjsdev/spark** Three.js renderer, either of which can display a `.ply`/`.spz` file in-browser with no GPU setup required from the visitor.
3. **On your slide, say exactly this:** "Every claim photo feeds a growing dataset per landmark. For our best-covered location we generated a real Gaussian Splat 3D model from crowd photos — [live/pre-generated] — viewable right in the browser. This is the seed of a city slowly building its own 3D twin, one claim photo at a time." That framing is honest, ambitious, and plays directly to the Data Intelligence track ("we collect real usage data and surface it visually") without overpromising a live per-landmark splat pipeline you don't have time to build reliably.

If you have a strong web/backend teammate and time allows after the core loop is solid, a genuinely live version is: batch-trigger Luma's API automatically once a landmark crosses ~15 photos, poll for completion, and store the resulting embed URL on the landmark row — but build this **last**, after everything in §3.1–3.8 works end to end.

---

## 4. Visual Identity & the Reve Track

Judges explicitly penalize "heavy reliance on generic, unedited AI generated visuals." Use **Reve** (app.reve.com) deliberately as your design backbone, not as a one-off illustration generator:

- Generate a distinctive **pin/marker icon set** (unclaimed, claimed, contested, iconic-tier) in one consistent illustration style — this single choice does more for "doesn't look like a default AI frontend" than almost anything else, since map pins are the most visually repeated element on screen.
- Generate a **logo/wordmark and a loading/empty-state illustration** (e.g., for "no claims yet near you") using Reve's reference-image feature to keep every generated asset in the same palette/style — set this up once (custom instructions in Reve describing your palette, line weight, mascot style) and reuse it for every asset so the whole app feels art-directed rather than piecemeal.
- Consider a small **claim mascot/character** (via Reve) that appears in the confetti/success animation on a successful claim — a recurring visual character is a cheap way to make the product feel personal and "your team's" rather than templated, which is explicitly called out under Originality & Creative Execution.
- Keep photography (the actual claim photos) real and unedited — Reve is for your *brand* layer (icons, empty states, marketing/landing polish), not for faking landmark photos.

---

## 5. Tech Stack Summary

| Layer | Choice | Why |
|---|---|---|
| Frontend framework | React + Vite (or Next.js if a teammate prefers SSR/routing conventions) | Fast dev loop, huge ecosystem, works great with Claude Code scaffolding |
| Map | MapLibre GL JS + MapTiler/Stadia free vector tiles | No billing account needed, real vector rendering, clustering + heatmap layers built in |
| Landmark data | OpenStreetMap Overpass API (one-time seed script) | Free, no key, real GTA data, thousands of points instantly |
| Backend / DB / Realtime / Auth / Storage | Supabase (Postgres) | One free-tier service covers DB, live subscriptions, anonymous auth, and photo storage — minimizes moving parts for 24 hours |
| Photo verification | Claude API (vision, multimodal message) | Reasons about arbitrary local landmarks given name/description context, unlike landmark-only detectors like Google Vision |
| Charts (dashboard) | Recharts | Fast to wire up in React, good default aesthetics |
| Visual identity | Reve (app.reve.com) | Sponsor track requirement, and genuinely solves the "generic AI look" problem |
| 3D splat viewer | SuperSplat (PlayCanvas, MIT) or @sparkjsdev/spark (Three.js) | Browser playback of `.ply`/`.spz`, no install |
| 3D splat generation (stretch) | Luma AI capture app/API | Best free consumer-grade splat quality; pre-process before demo rather than depend on live generation |
| Hosting | Vercel (frontend) + Supabase (backend, already hosted) | Deploy in minutes, satisfies "must be public and live," free tier is enough for hackathon traffic |

---

## 6. Data Model

```
landmarks
  id (uuid, pk)
  name (text)
  lat, lng (float)
  tier (int: 1=standard, 2=landmark, 3=iconic)
  category (text — from OSM tag, e.g. "historic", "artwork", "park")
  osm_description (text, nullable)
  claim_requirement (text: "standard" | "co_claim" | "trivia_gate")
  trivia_question / trivia_options / trivia_answer (nullable, for tier 3 trivia landmarks)
  photo_count (int, denormalized counter for splat-eligibility threshold)
  splat_url (text, nullable — set once a 3D model exists for this landmark)

users
  id (uuid, pk)
  handle (text, unique)
  avatar_color (text)
  created_at

claims
  id (uuid, pk)
  landmark_id (fk)
  user_id (fk)
  co_owner_id (fk, nullable — for co_claim tier-3 landmarks)
  claimed_at (timestamptz)
  expires_at (timestamptz, generated = claimed_at + interval '3 hours')
  photo_url (text, Supabase Storage public URL)
  ai_confidence (int)
  ai_is_match (bool)
  gps_distance_m (float)
```

`landmark.current_owner` is never stored — always derive via `claims WHERE landmark_id = X AND expires_at > now() ORDER BY claimed_at DESC LIMIT 1`. This removes an entire class of expiry/consistency bugs.

---

## 7. API/Endpoint Surface (backend logic, whether via Supabase Edge Functions or a thin Node/Express layer)

- `GET /landmarks?bbox=...` — return landmarks in viewport with current owner (join against latest non-expired claim), for map rendering.
- `GET /landmarks/:id` — full detail: photo history, claim history, trivia question if applicable, splat_url if present.
- `POST /claims` — body: `{landmark_id, user_handle, lat, lng, photo}`. Server-side logic:
  1. Recompute Haversine distance server-side too (never trust client-reported "in range" alone) — reject if > radius.
  2. Check current owner via the derived-owner query; reject if claimed and not expired (unless requester is already the current owner, i.e. re-claiming their own spot early is fine or disallowed — pick one, disallow is simpler).
  3. If tier 3 with `co_claim`: check for a pending co-claimant window (see §3.6).
  4. If tier 3 with `trivia_gate`: verify the answer was correct client-side already (trivia gating is UX, not security — fine for a hackathon).
  5. Call Claude vision API with the photo + landmark context; parse JSON response.
  6. If pass: insert claim row, increment `photo_count`, upload photo to Storage, return success + new `expires_at`.
  7. If fail: return the `reasoning` string so the UI can show *why* ("Photo doesn't look like Casa Loma — try getting the towers in frame") — this is good UX and a nice technical-craft detail to show judges.
- `GET /leaderboard?scope=current|alltime&tier=&category=` — the queries from §3.7.
- `GET /dashboard/stats` — aggregate counts for the dashboard widgets (or just subscribe directly to Supabase Realtime from the frontend and compute client-side, skipping this endpoint entirely — simpler for a hackathon).
- `POST /landmarks/:id/generate-splat` — stretch feature, triggers/links the Luma pipeline.

---

## 8. Non-Functional / Judging-Aligned Details to Not Skip

- **Deploy early, not at the end.** Get a bare Vercel deployment live in hour 1 with just the map and static pins, and keep deploying continuously. "Must be public and live" is graded — a laptop-only demo the night before submission is a real risk if something breaks on deploy at 12:45 PM.
- **Mobile-first CSS.** Judges will likely test this on their own phones while walking around, since it's a location game — the bottom-sheet detail card, big tap targets, and camera flow all need to work one-handed on a phone, not just look good on a laptop demo screen.
- **Geolocation permission UX.** Handle the "location denied" case gracefully (fall back to a default Toronto view, show a friendly re-prompt) — a hard crash on permission denial is the single most likely live-demo failure for a location app.
- **Seed a few pre-claimed landmarks before the demo** so the map isn't empty on load — an empty map reads as unfinished; a partially-alive map reads as a living platform.
- **Explain the transformation on your slide explicitly**, per the rubric: one sentence naming "GPS distance check + Claude vision verification against landmark metadata" as your technical core.

---

## 9. Cut List — what NOT to build tonight (be disciplined here)

- ❌ World/country-tiered leaderboards beyond GTA — no data to back it, reads as padding (see §3.7).
- ❌ Live per-claim, per-landmark Gaussian Splat generation as a required feature — pre-process one showcase landmark instead (see §3.9).
- ❌ Custom minigames for iconic landmarks — use co-claim or trivia-gate, not a built minigame engine (see §3.6).
- ❌ User accounts with passwords/email — handle-only identity is enough and removes an entire auth surface.
- ❌ Native mobile app — a responsive mobile web app satisfies "public, live, zero install," which is strictly better for a hackathon demo than an app-store-gated app.
- ❌ Manual landmark data entry — Overpass API seed script only (see §3.2).
- ❌ A generalized "any city" picker — ship GTA only, mention the architecture generalizes, don't build the UI for it.

## 10. Suggested Build Order (hour-by-hour, adjust to team size)

1. **Hr 0-1:** Repo scaffold (Vite + React), Supabase project created, run the Overpass query, write the seed script, get landmarks into the DB. Deploy a bare skeleton to Vercel immediately.
2. **Hr 1-3:** Map renders real pins from Supabase, clustering works, tapping a pin opens the detail card (static data first, no claim logic yet).
3. **Hr 3-5:** Claim flow UI: geolocation distance check, camera capture, "Claiming..." state — wire to a stub endpoint that always succeeds, so the frontend flow is fully clickable end to end early.
4. **Hr 5-7:** Real backend claim endpoint: Haversine check, Claude vision call, insert into `claims`, derive current-owner logic, expiry countdown rendering.
5. **Hr 7-9:** Supabase Realtime wired up — claims from one browser appear live on another without refresh. This is your "wow" moment for judges watching — prioritize it before polish.
6. **Hr 9-11:** Leaderboards + dashboard page (live feed, heatmap, claims-over-time chart) — all real queries, no mock data.
7. **Hr 11-13:** Reve visual identity pass — pins, logo, empty states, mascot — swap in everywhere.
8. **Hr 13-15:** Tier-3 iconic landmark mechanic (pick co_claim or trivia_gate), seed 5-10 iconic landmarks with it.
9. **Hr 15-17:** Stretch: photo mosaic per landmark (always), and if time allows, pre-generate one splat and embed it with SuperSplat/Spark.
10. **Hr 17-20:** Mobile testing/polish, permission-denial fallback, seed a few pre-claimed pins, deploy stability pass.
11. **Hr 20-22:** Slide deck: name the transformation explicitly, screenshot/record the live dashboard ticking up, write the "why we built this" personal-genuine paragraph the rubric explicitly rewards.
12. **Remaining time:** buffer for the inevitable — do not schedule new features into this window.

---

## 11. One-Sentence Pitches for Each Rubric Line (use directly in your slide/pitch)

- **Solution Design:** "Open the link, see the map, tap a glowing pin, take one photo — claimed in under a minute, no signup wall."
- **Technical Craft:** "Every claim is verified live by two independent checks — GPS distance and Claude vision comparing your photo against the landmark — and you can watch the map update on someone else's phone in real time."
- **Originality & Creative Execution:** "A city-wide scavenger hunt that turns Toronto itself into the game board, with a hand-designed visual identity built in Reve so it doesn't look like every other hackathon map app."
- **Lasting Value & Community:** "Landmarks stay contested forever — three hours after your claim, someone can take it back — so the map (and the leaderboard) is a living thing that only gets more interesting the longer people keep playing."
