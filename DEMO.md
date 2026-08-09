# The 3-minute indoor demo

Constraints this is built for: you arrive 3:00, judging 3:03, indoor room, no
prior photos, nobody goes outside.

**The insight:** an empty archive is the *strongest* version of this demo. With
60 photos a judge's contribution is noise. With zero, their photo literally
defines the colour of the neighbourhood. Lean into it.

---

## Before you walk in (30 seconds)

- Open the site on your phone. Confirm the pin **SummerHacks @ Stackt Market**
  is unclaimed.
- Open `/dashboard.html` on the laptop and leave it on screen — it's the
  scoreboard the judges watch change.

## The script

**0:00 — the premise**
> "This is SEEN. These are 41 real places within a few blocks of here, pulled
> from OpenStreetMap. You claim one by standing there and taking a single photo.
> Nobody has photographed any of them yet — the archive opens today."

**0:20 — hand them your phone**
> "Take a photo of anything in this room."

They shoot. GPS verifies server-side. A duplicate-hash check runs. Vision
confirms plausibility. Their photo lands.

**0:50 — the payoff, on their screen**
> "That's yours now, for three hours. And look — the neighbourhood had no
> colour thirty seconds ago. That's *your* photo's palette. You just decided
> what this part of Toronto looks like."

**1:10 — the 3D city** (tap the **3D** chip)
> "Every place is a column. Grey and low means nobody's looked at it. Yours just
> rose and took colour. Height is attention; colour is what the place actually
> looks like. That's the whole city as a dataset."

**1:40 — the dashboard** (laptop)
> "This is live, and every number came from real usage. The colour of the
> neighbourhood, the day hour by hour, and — this one I like — our verification
> telemetry: every claim attempt logged, pass rate, mean confidence, and exactly
> why claims were refused. That's our production accuracy, not a sample."

**2:20 — how it's verified** (if asked, or to fill time)
> "Three checks: GPS recomputed server-side, so we never trust the client. A
> perceptual hash against every photo ever taken at that place, so you can't
> reuse a picture. Then a vision model for plausibility — and if that API is
> down, the deterministic checks still carry the claim. Nothing here can be
> faked, which is why the data on that dashboard is worth trusting."

**2:50 — close**
> "The claim expires in three hours. The photograph never does. That's the
> point: the game rotates, the archive only grows."

---

## Q&A ammunition

**"Why is there so little data?"**
> "It launched last night and this room is the first crowd. That's honest —
> and you can watch it grow: the second judge who tries it will see your photo
> already in the archive."

**"Is this data real?"**
> "The system won't let it be fake. GPS is verified server-side, duplicate
> photos are refused, and every photo is public on its pin with a timestamp.
> Tap any pin and check."

**"Did you use RAG / what model?"**
> "Every model call is grounded in retrieved landmark metadata — name, category,
> OSM description. We didn't add a vector store because the corpus is 41 rows
> with keys; retrieval by ID beats retrieval by similarity here. We sized the
> architecture to the problem."

**"What about a 3D reconstruction of a landmark?"**
> "The pipeline is wired — a landmark with enough photos gets a real
> reconstruction attached and shown on its pin. What you're seeing today is the
> city-scale 3D view, which is built from live data rather than a capture."

**If a claim fails indoors** — this is a feature, say so:
> "GPS is weak indoors, and the system refuses claims it can't verify. That
> refusal is logged — it's on the dashboard under 'why claims were refused'.
> Better to reject an honest claim than accept a fake one."

---

## Fallbacks

- **Claim won't go through:** show the specimen instance (`npm run specimen`,
  port 8788) — it's labeled SPECIMEN on every page, and demonstrates the
  populated vision honestly.
- **Site is down:** the laptop is the server. Check the tunnel is alive.
- **Wifi is bad:** use your phone hotspot for the laptop.
