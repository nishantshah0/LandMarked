# Brand assets (Reve)

Everything in this folder is **optional**. Nothing here is required for the app
to run — drop a file in and it appears; leave it out and the current CSS chrome
ships unchanged. Nothing you do in this folder can break the map.

Served from the site root: `web/public/brand/pin-free.svg` → `/brand/pin-free.svg`.

## The files the code already looks for

| File | Size | Where it lands | Without it |
|---|---|---|---|
| `pin-free.svg` | 90×90 (renders at 30px) | unclaimed pins | dashed circle, breathing |
| `pin-owned.svg` | 90×90 | held pins | filled circle |
| `pin-venue.svg` | 114×114 (renders at 38px) | tier-2/3 pins incl. the venue | larger circle |
| `mark.svg` | height ~20px | wordmark in the header | the word SEEN in type |
| `og.png` | 1200×630 | link previews, Devpost card | no preview image |

`pin-free.svg` is the probe. If it loads, `data-brand="on"` goes on `<html>` and
the illustrated pins take over. If it 404s, nothing changes. So **add
`pin-free.svg` last**, once the other two pins exist — otherwise you get one
illustrated state and two blanks.

## Why the pins matter more than the logo

Forty-one pins are on screen at all times. They are the most repeated element in
the product by a wide margin, and they are currently generic circles. The Reve
track asks whether the visual identity *"clearly stands apart from a default,
templated AI look"* — the pins are where that is won or lost.

## Palette — paste this into Reve's custom instructions

```
Brand: SEEN — a map where people claim real places with photographs.
Palette, strict, no other colours:
  ink    #17181C   paper  #F7F5EF
  accent #E5533D   near   #3F7D49
Style: flat vector, no gradients, no drop shadows, no 3D, no glow.
Uniform 2.5px stroke weight. Geometric, slightly imperfect, hand-drawn
confidence — not corporate. Generous negative space.
Everything must read clearly at 30 pixels.
Transparent background.
```

Generate **one** pin, pick the best, then feed it back as a **reference image**
for every other asset. Consistency across the set is the hard part, and
reference images are the feature that solves it.

## The edit pass is not optional

The main rubric marks down *"generic, unedited AI generated visuals"*, so raw
output shipped as-is costs Originality points while chasing a bonus prize.
Before anything lands here:

- snap every colour to the exact hex values above — generated output drifts
- unify stroke weights to one value
- redraw at final size rather than scaling down
- hand-kern the wordmark yourselves; that is the strongest hand-made signal

Keep the raw Reve output for one pin alongside the edited version. Showing
"here is what we generated, here is what we did to it" answers the Reve
criterion directly and pre-empts the unedited-AI markdown before a judge raises
it.

## Concept worth trying

The product answers *what colour is this neighbourhood right now*. An identity
built **out of colour** — a mark of stacked swatches that could plausibly be the
live blended palette — encodes what the product is rather than decorating it.
That is what the track means by "design backbone."
