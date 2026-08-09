# The 3-minute indoor demo

Built for: arrive 3:00, judging 3:03, indoor room, no photographs beforehand,
nobody goes outside.

**The one idea to hold onto:** an empty archive is the *strongest* version of
this demo, not the weakest. With sixty photographs a judge's contribution is
noise. With none, **their photo decides the colour of the neighbourhood.** Lean
all the way into that.

---

## Before you walk in (30 seconds)

- Site open on your phone. Confirm **SummerHacks @ Stackt Market** is unclaimed.
- `/dashboard.html` open on the laptop, left on screen. It is the scoreboard.
- Know your two numbers: **4,235 places**, **46% say something specific**.

## The script

**0:00 — open on the data page, not the map.** This is the change: the dashboard
now has real content before anyone photographs anything.

> "A city gets documented twice. There's the official record — OpenStreetMap
> knows 4,235 places around this building, and 46% of them can actually tell you
> something about themselves: an inscription, an artist, a date. And there's the
> record in everyone's camera roll, which is private and gets thrown away.
> SEEN holds both."

Point at the grounding bars.

> "172 places have a named artist. 27 have an inscription. Those get a question
> about themselves. Everything else gets an honest question about its category —
> because inventing a fact about a real place is the one thing we won't ship.
> That split is a chart, not a promise."

**0:45 — hand them your phone.**

> "Take a photo of anything in this room."

They shoot. GPS verifies server-side, the hash checks it against every photo ever
taken there, the vision model confirms plausibility.

**1:15 — the payoff, on their screen.**

> "That's the second dataset, and it was empty thirty seconds ago. That colour is
> yours. You just decided what this part of Toronto looks like."

**1:45 — the 3D city** (tap **3D**).

> "Every place is a column. Grey and low means nobody has looked at it. Yours
> just rose and took colour. Height is attention; colour is what's actually
> there."

**2:15 — verification** (dashboard).

> "Every attempt is logged, passed or failed, with distance and confidence.
> That's our real accuracy in production. GPS is recomputed server-side so we
> never trust the client, and a perceptual hash means you can't submit a photo
> that's already been used here."

**2:45 — close.**

> "The claim expires in three hours. The photograph never does. The game rotates;
> the archive only grows."

---

## If more than one person is around

Ask the room. Every extra photo makes the colour truer, the feed scroll, and the
leaderboards populate — live, in front of the judge. That is TECHNATION's own
bonus criterion ("the dashboard updates live while judges are watching") and it
cannot be faked.

## Q&A

**"Why is there so little data?"**
> "It launched last night — but look at the top half of this page: 4,235 places
> measured before anyone photographed anything. The photographs are the second
> layer, and you're about to be the first entry."

**"Is this data real?"**
> "The system won't let it be fake. GPS is verified server-side, duplicate photos
> are refused, and every photo is public on its pin with a timestamp. Tap any
> pin and check."

**"What model? Did you use RAG?"**
> "Every model call is grounded in retrieved landmark metadata — name, category,
> the exact OSM tags. We didn't add a vector store because the corpus is rows
> with keys; retrieval by ID beats retrieval by similarity. We sized the
> architecture to the problem."

**"Did you do 3D?"**
> "We built a Gaussian splat pipeline and removed it. Crowd photos from mixed
> phones and angles don't reconstruct cleanly, and we weren't going to advertise
> output the input can't support. The 3D you're seeing is the city view — built
> from live claim data, works with one photo."

**If a claim fails indoors — this is a feature, say so:**
> "GPS is weak indoors, and the system refuses claims it can't verify. That
> refusal is logged — it's on the dashboard under 'why claims were refused'.
> Better to reject an honest claim than accept a fake one."

## Fallbacks

- **Claim won't go through:** the specimen instance (`npm run specimen`, :8788)
  shows the populated vision, labeled SPECIMEN on every page.
- **Site down:** the laptop is the server — check the tunnel is alive.
- **Bad wifi:** phone hotspot for the laptop.
