# Design brief: what to take from Strava and Google Calendar

## Why this exists

Two screenshots were shared during the v2 refinement, of Strava and Google Calendar, as
the visual direction for Lifeboard. Only one idea was ever extracted from them into an
agent brief, progressive disclosure, which shipped: dates now hide behind "Add a deadline"
rather than sitting on the create form. The visual language itself was never written down
anywhere and so was never built.

**Caveat the next reader needs.** The original screenshots are not in this repo and were
not described in any log at the time. What follows is reconstructed from what those two
apps consistently do, not from the specific screens that were shared. Check it against
what you actually meant before an agent acts on it, particularly the Strava half, which
has changed a lot across versions.

## What is worth taking

### From Google Calendar: density without clutter

The calendar tab already borrows the marks idea, and that part is done. What is not taken
yet:

**One accent, used sparingly.** Google Calendar is mostly greyscale with colour reserved
for the things that carry meaning: the event chips and today's date. Lifeboard currently
spends colour in more places than that. The category hue is on the card edge, the lead
date is `--now` for anything pressing, the accent is on the active filter chip, the amber
`--doing` ring is on started cards, and the review card has its own treatment. Audit
`src/components/ItemCard.tsx` and count how many coloured elements can appear on one card
at once. Target: at most two, and never two of the same weight.

**Weight, not boxes, for hierarchy.** Google Calendar separates the month grid, the day
panel and the event list with space and type size rather than borders and cards. Lifeboard
puts a border and a card background on nearly everything. `ItemCard`'s `quiet` weight
already drops the background; consider pushing further so only the leading lane draws a
card at all and everything else is a row with space around it.

**The current moment is the only thing that glows.** Today's date is a filled disc; nothing
else is. Lifeboard's equivalent should be that the single most pressing item reads as the
brightest thing on screen, and that brightness is not shared with five others.

### From Strava: the number is the headline

**One figure, large, unlabelled.** Strava leads a screen with a single number at a size
nothing else competes with, and the label sits underneath in small caps. Lifeboard has
lane counts as small monospace numerals beside headings, which is the opposite emphasis.
Where a count actually matters, and Slipped is the only one that clearly does, it could
carry that treatment: the number large, "slipped" small beneath it.

**Streaks earn their prominence, or they go.** `Item.streak` exists and renders as a
"3 done" fact among six others in `ItemCard`. Strava would either make a streak a
first-class visual or not show it. Decide which; the current middle ground is the worst of
both. Given the goals rework put recurring commitments under goals, the streak arguably
belongs on the goal, not the item.

**Restraint in typography, licence in data.** Strava uses one typeface at a few decisive
sizes, and spends its visual energy on the data. Lifeboard's scale in `src/index.css`
(`--text-micro` through `--text-lead`) is already tight, which is good; check it is
actually being used rather than bypassed with arbitrary Tailwind sizes. `grep` for
`text-\[` across `src/` and see how many literal sizes have crept in.

## What to explicitly not take

**Not Strava's social layer or its gradients.** No kudos, no achievement badges, no
celebratory colour washes. This is a private tool for one person and a completion is
already acknowledged by the chime and the strike-through.

**Not Google Calendar's chrome.** No hamburger, no floating multi-action compose button, no
view switcher. The four-tab bar is settled and adding on the calendar is per day now.

**Not either app's information density at the top.** Both apps put a lot in a header
because they have a lot of surfaces. Lifeboard's header is a title and two icons and should
stay that way.

## Concrete first pass, in order

1. Count the simultaneous coloured elements on one card in each lane and reduce to two.
2. Try Slipped's count as a large numeral with a small label, and judge it on the device.
3. Decide where streaks live, on the item or the goal, and remove the other.
4. Audit for literal type sizes and colours that bypass the tokens, and fold them back in.
5. Push the `quiet` weight further toward rows-with-space and away from cards-with-borders.

Judge every one of these at 375px on a real Android device in both themes, not in a desktop
browser at a narrow width. The date-input clipping that prompted this round did not
reproduce on desktop at all.
