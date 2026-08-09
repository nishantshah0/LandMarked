# The 90-second demo — one page

**Setup (before judges):** laptop on `/now.html`. Phone on the map. Venue pin unclaimed.

---

**0:00 — laptop, the pulse page.**

> "A city is documented twice. The official record — OpenStreetMap knows **4,235
> places** around this building, **46%** of which can say something real about
> themselves. And everyone's camera roll, which is private and thrown away.
> SEEN merges them."

**0:20 — hand over your phone.**

> "Take a photo of anything in this room."

GPS verified server-side → duplicate-hash check → vision check. Their photo lands.

**0:40 — the payoff.**

> "The archive was empty. That colour on every page now — that's *your*
> photograph. You just decided what this neighbourhood looks like."

**0:55 — the room joins.** Point at the QR on the pulse page.

> "Anyone — scan, shoot one photo."

Presence climbs. Feed scrolls. Trending builds. The colour clock gets its first
segment. All live, in front of them — nothing here can be pre-faked, which is
the point.

**1:15 — one data beat, laptop.**

> "Every claim attempt is logged with its reason — that's our real production
> accuracy, not a sample. And the questions on all 4,235 places: **1,233** are
> about the exact spot, because the record had real facts; **3,002** are about
> the category, because inventing a fact about a real place is the one thing
> we won't ship. Our honesty policy is a chart."

**1:30 — close.**

> "Claims expire in three hours. Photographs never do. The game rotates;
> the archive only grows."

---

## If asked

- **Little data?** → "Launched last night. Top half of the dashboard is the
  corpus — measured before any photograph. You're watching the second dataset
  being born."
- **Real?** → "Tap any pin: public photos, timestamps. GPS is recomputed
  server-side, duplicates are refused by perceptual hash."
- **Model?** → "Claude → Gemini → OpenAI behind one interface, grounded in each
  place's OSM record, degrading to deterministic checks. We sized the
  architecture to the problem."
- **Claim fails indoors?** → "It refuses what it can't verify — and logs why.
  See 'why claims were refused'. Feature, not bug."

## The three numbers to know cold

**4,235** places · **46%** say something specific · **1,233 / 3,002** place-vs-category questions
