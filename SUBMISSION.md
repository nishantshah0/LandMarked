# SEEN — Devpost submission

**Live:** `<paste the current URL>` · **Data:** `<same>/dashboard.html` · **Code:** https://github.com/nishantshah0/LandMarked

---

## Elevator pitch (short field)

Claim a place with one photo. The place keeps every photo, forever — and the neighbourhood's colour is measured from them.

---

## Inspiration

A city is documented twice and neither record is much good on its own. There's the official one — OpenStreetMap knows 4,235 places around us, and 46% of them can say something specific about themselves: an inscription, an artist, a date, a material. And there's the one in everyone's camera roll, millions of photographs of the same corners, all private and all thrown away.

We wanted one artifact that holds both. Not a photo dump and not a map — a place that knows what it is *and* what it currently looks like, according to the people standing in front of it.

## What it does

Real landmarks near you are claimable pins. Stand at one, take a single photo, and it's yours for three hours — until somebody else walks up. No account, just a handle.

The claim is the game. The point is what it leaves behind: **your photograph joins that place's permanent archive.** Claims rotate; archives only grow. Every photo is also measured — dominant palette, brightness, saturation, how much sky is in frame — and blended into a **live colour for the whole neighbourhood**, sliced hour by hour so you can watch the day turn.

Iconic places are locked behind a question about that place, answered against a key the browser never receives.

## How we built it

Vanilla TypeScript, one Node process, `node:sqlite`, photos on disk. MapLibre with keyless OpenFreeMap tiles. No framework, no ORM, no external service on the critical path.

**The transformation — one photo passes three independent checks:**

1. **GPS, recomputed server-side.** A client that says it's standing somewhere is never believed.
2. **A perceptual hash (dHash) against every photo ever accepted at that place.** Deterministic, explainable, and it kills re-uploads and lightly-edited copies.
3. **A vision model for plausibility**, grounded in that landmark's real OSM metadata — with Claude, Gemini and OpenAI behind one interface, and graceful degradation to the deterministic checks if every provider is down.

Every attempt is logged pass or fail with its reason, distance and confidence. That log *is* the verification panel on the dashboard.

**The measurement is arithmetic, not a model.** The client downsamples the capture on a canvas; the server hashes it, extracts the palette, and blends. Anyone can check the maths.

## Challenges

**Not inventing facts.** We wanted a question on every landmark, and most OSM entries are a name and a category — nothing to ask about. Generating one anyway means a plausible fabrication pinned to a real place, which is the worst thing this project could ship. So the generator returns a *scope*: a place with real material gets a question about itself; a place without gets an honest question about its category. That split is on the dashboard, counted.

**Photogrammetry we cut.** We built a full 3D reconstruction pipeline and removed it. Crowd photos from mixed phones, angles and lighting don't solve cleanly, and shipping it would have meant advertising output the input can't support.

**Rendering a whole city.** A DOM marker per landmark is right for a few hundred and catastrophic for four thousand. Below street zoom the map draws GPU-clustered counts; above it, only the pins inside your viewport, diffed rather than rebuilt.

## What we learned

That the honest version was usually also the better-engineered one. Deriving ownership from claims instead of storing it deleted an entire class of expiry bugs and removed the need for a cron. Refusing to fabricate forced the scope field, which turned out to be the most interesting thing on the data page.

## What's next

Every accepted photograph makes the colour truer and the archive longer. The architecture is city-agnostic — re-run the seed with a different bounding box and it's a different city.

---

## TECHNATION — Data Intelligence

Everything below is public at `/dashboard.html`, first-class product surface rather than an admin route, live over the same WebSocket as the map, and downloadable raw at `/api/state`.

**Two datasets, both real.** The corpus: 4,235 places, what kinds they are, how many say something specific about themselves and via which exact tags (religion 1,030 · operator 549 · start date 210 · material 180 · artist 172 · inscription 27), Wikipedia coverage, oldest datable structure, median spacing, distance bands. The archive: the live neighbourhood palette, hour by hour, per-place colour, extremes.

**Verification telemetry.** Attempts logged, pass rate, mean confidence by tier, and every refusal reason. That's our production accuracy, not a sample.

**And the integrity story is itself a chart.** The place-scoped vs category-scoped question split shows, in numbers, where we had real material and where we refused to invent it.

## Best Use of Reve

The interface is deliberately near-monochrome — grayscale basemap, ink-and-paper chrome, editorial serif — so that **the only colour anywhere on screen is colour measured from someone's photograph**: the pin tints, the palette bar, the dashboard hero. Reve assets drop into `web/public/brand/`; `mark.svg` replaces the wordmark automatically.
