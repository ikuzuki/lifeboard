# Design brief: default categories

## Why this exists

The current defaults in `src/lib/categories.ts` are Health, Exercise, Career, Admin, Events,
Home and Learning. Seven of them, against a hard ceiling of ten. They were chosen quickly and
have never been argued for, and two of them look wrong from the outside: Health and Exercise
overlap, and Admin is broad enough to swallow anything you cannot be bothered to think about.
This brief is the argument, and it changes four of the seven.

Category is not a filing convenience in this app, it is the primary visual encoding. Each one
owns a hue that becomes the left edge of every card in `ItemCard.tsx`, the dot on a goal in
`GoalsView.tsx`, the dot on a calendar day in `CalendarView.tsx`, and the filter chip row on
Today. So the recommendation has to survive two separate tests: it has to be a taxonomy you can
file into without hesitating, and it has to be a palette that stays legible at 3px and 6px in
both themes. Those two tests pull in opposite directions, and the second one turns out to be the
binding constraint. That is the most useful thing in this document.

**Where I have verified something from a source, it is linked. Where it is my judgement, I say
so.** The two are kept apart deliberately, because the life-domain literature is genuinely good
and the to-do-app literature is genuinely thin, and blurring them would let me borrow authority I
do not have.

## The recommendation

**Seven categories, the same count as today, with four of the seven changed.**

| # | Category | Colour | Why it earns a slot |
|---|---|---|---|
| 1 | **Health** | red (hue 15) | Appointments and medical admin, the body as something other people's calendars act on. Present in every taxonomy checked, without exception. |
| 2 | **Exercise** | green (160) | Training, not health. Holds the habit-shaped and goal-shaped items, and is the only category a future integration would ever write into. |
| 3 | **Career** | blue (230) | Work, applications, the CV, the thing you are trying to become. Universal across taxonomies and high volume here. |
| 4 | **People** | violet (305) | Replaces Events. Ring your mother, the birthday present, the reply you owe, the dinner you keep not booking. The highest-slippage class of task in a life, and currently homeless. |
| 5 | **Home** | orange (55) | The physical place and its upkeep. Repairs, furniture, the standing desk. Absorbs most `buy` items naturally. |
| 6 | **Admin** | slate (achromatic) | Bureaucracy: renewals, claims, bills, forms, the phone calls that only happen on a weekday. Kept, deliberately demoted, and deliberately colourless. |
| 7 | **Learning** | yellow (100) | The discretionary growth slot. Low volume, holds goals rather than deadlines, and put on the weakest colour for exactly that reason. |

Order is load-bearing rather than alphabetical; see [Ordering](#ordering). The three palette slots
left unused are teal, indigo and pink, and leaving those three specifically is a choice explained
in [The colour constraint](#the-colour-constraint).

Against today that is **Events cut, People added, and three colours reassigned** (Career indigo to
blue, Home violet to orange, Learning teal to yellow). Health, Exercise, Career, Admin, Home and
Learning all survive as labels. Nothing is renamed.

### The evidence

The life-domain literature is older and better than I expected, and it converges hard.

The most useful single paper is [Cummins, *The domains of life satisfaction: an attempt to order
chaos*](https://link.springer.com/article/10.1007/BF00292050) (Social Indicators Research, 1996).
It took **173 different domain names** found across the quality-of-life literature and tried to
force them under the seven headings of the Comprehensive Quality of Life Scale: health,
productivity, material wellbeing, intimacy, safety, emotional wellbeing and community. **68% of the
173 names fitted, rising to 83% of the reported data** once repeated names are weighted. Two things
follow. First, seven headings really do cover most of what people spontaneously name, which is
direct evidence that a seven-slot ceiling is not arbitrarily tight. Second, roughly a third of the
vocabulary did not fit, which is direct evidence that no seven-item set is complete and that an
escape hatch is mandatory. Lifeboard already has the escape hatch: every item may be uncategorised
and the UI labels it "Other". That existing decision is load-bearing for everything below.

The same paper found a hierarchy of domain satisfaction **dominated by intimacy**. Relationships
are not one domain among seven, they are the one that moves the needle most. That is the strongest
citation in this document for adding People, and it is a finding rather than my taste.

The instruments agree with each other and with Cummins. The [Personal Wellbeing
Index](https://novopsych.com/assessments/well-being/personal-wellbeing-index-adult-5-pwi-a/) uses
seven domains - standard of living, health, life achievement, personal relationships, personal
safety, community connectedness, future security - selected as the first-level deconstruction of
satisfaction with "life as a whole". The [WHOQOL-BREF](https://pubmed.ncbi.nlm.nih.gov/9626712/)
collapses further, to four: physical health, psychological health, social relationships and
environment, with finances, home environment and access to learning all living inside environment.
Positive Psychology's [survey of life
domains](https://positivepsychology.com/what-are-life-domains/) records Headey and Wearing (1992)
using leisure, work, marriage, standard of living, health, sex life and friendship, and VanderWeele
(2017) reducing to five: spirituality, family, work, health and community. The same page notes that
Cummins's meta-analysis spanned **as few as 5 domains to as many as 15**.

The practitioner frameworks land in the same place from a different direction. The [Wheel of
Life](https://www.thecoachingtoolscompany.com/wheel-of-life-complete-guide-everything-you-need-to-know/)
is usually eight segments: health and fitness, career and work, finances, relationships and family,
personal growth, fun and recreation, physical environment, spirituality. Worth knowing that Paul J.
Meyer's original 1960s version had **six** categories, and that the eight-to-ten segment version is
a later coaching convention rather than a finding. GTD's [Areas of Focus at the 20,000ft
horizon](https://gettingthingsdone.com/2011/01/the-6-horizons-of-focus/) are defined as the parts of
life you have a responsibility to maintain, with the standard examples being health, family,
finances, home environment, spirituality and recreation, and with the explicit instruction that
your list is individual to you. PARA's [Areas of
responsibility](https://every.to/forte-labs/para-an-introduction-827085) are "a sphere of activity
with a standard to be maintained over time", with health, finances, family, travel, hobbies,
apartment and car given as personal examples.

**Where they agree, unanimously:** health, work, money, relationships. Those four appear in every
single set above, in some wording.

**Where they mostly agree:** home or physical environment, learning or personal growth, leisure or
recreation.

**Where they split:** spirituality, safety, community and emotional wellbeing appear in the
psychology instruments and in the coaching wheel and are absent from the productivity frameworks.
That split is not noise, it is the tell. The wellbeing instruments classify **what a life consists
of**; the productivity frameworks classify **what generates work**. Safety and emotional wellbeing
are real domains that produce almost no discrete, datable tasks. Lifeboard is a tracker, not a life
audit, so it should follow the productivity frameworks here and drop all four. That is my judgement,
but it is a judgement about which of two verified and disagreeing traditions applies rather than a
guess.

The second tell runs the other way, and it is the more interesting one. **Admin appears in none of
the taxonomies.** Not in Cummins's seven, not in the PWI, not in the Wheel, not in GTD's examples,
not in PARA's. And yet renewing the insurance, claiming for the delayed flight, chasing the water
bill and ringing the water company are four of the eighteen items in `src/seed.ts`, which is to say
bureaucracy is the largest single class of task in the app's own demo data. The reason no wellbeing
model has an Admin domain is that nobody's life satisfaction depends on having renewed their car
tax; the reason a tracker needs one is that the car tax will bite you anyway. A to-do app therefore
needs a bucket that no life-domain model has, and that is why Admin stays despite being the category
I like least.

### How comparable apps do it

**The honest answer is that essentially none of them ship life-domain categories, and that is the
most important finding in this section.** I went looking for six default sets to compare against and
found approximately zero.

[Google Tasks](https://zapier.com/blog/google-tasks-guide/) creates a single **My Tasks** list and
has **no label or tag feature at all**. Lists and subtasks are the only organising tools it has.

[Microsoft To Do](https://support.microsoft.com/en-us/todo/my-day-and-suggestions) ships **My Day**
and **Tasks**, plus smart lists (Important, Planned, All, Completed, Assigned to me, Flagged email).
Every one of those is a *state* or a *filter*, not a life domain.

[Todoist](https://www.todoist.com/help/articles/get-started-with-todoist-OgNNJR) starts a new
account with **Welcome** and **Try Boards**, which are tutorial content rather than taxonomy, plus
the Inbox as the default home for anything unfiled. Its label feature, the closest analogue to a
Lifeboard category, [ships with no default labels
whatsoever](https://www.todoist.com/help/articles/introduction-to-labels-dSo2eE); the user creates
all of them.

Things has [Areas of Responsibility](https://culturedcode.com/things/blog/2009/05/syncing-areas-of-responsibility-and-more/)
as a first-class concept sitting above Projects, explicitly modelled on GTD, and ships none of them.
Its built-in lists are Inbox, Today, Upcoming, Anytime and Someday, which again are states and
horizons rather than domains.

[TickTick](https://help.ticktick.com/articles/7055782283059396608) supports a
Folder / List / Section / Task hierarchy and documents Work, Personal and Life as examples you *can*
create. I could not find documentation confirming that any of those ship by default, and I am not
going to assert it on the strength of a tutorial screenshot.

[Apple Reminders](https://support.apple.com/en-us/105086) is the one genuine exception, and it is
instructive that the exception is about shopping rather than about life. Set a list's type to
Groceries and Reminders auto-sorts items into **twelve fixed categories**: [Produce, Breads &
Cereals, Frozen Foods, Snacks & Candy, Meat, Dairy, Eggs & Cheese, Bakery, Baking Items, Household
Items, Personal Care & Health, and Wine, Beer &
Spirits](https://www.macrumors.com/how-to/create-groceries-lists-ios-reminders/), hiding any category
with nothing in it. So Apple was willing to ship a twelve-item taxonomy for a domain where the
categories are objective and externally defined, supermarket aisles, and unwilling to ship any
taxonomy at all for the domain where they are subjective.

**What I take from the set.** The industry position is that categories are user data and that
shipping defaults is presumptuous, and the industry can afford that position because every one of
those apps has an Inbox that makes an unfiled item a first-class citizen. Lifeboard differs in two
ways that flip the answer. It has one owner rather than a market, so "presumptuous" is not a risk,
it is a first draft he renames in Settings. And its categories *are* the visual encoding, so
shipping zero of them means shipping an app where every card has a grey edge and the filter row is
empty, which is not a neutral starting state but a broken-looking one. Shipping defaults is right.
The industry's silence means the defaults have to be argued from the wellbeing literature rather
than copied, which is what this brief does.

The other thing worth stealing is Apple's hide-when-empty behaviour, which the Today chip row could
apply to categories with nothing live in them. That is a UI note rather than a taxonomy note and it
is in the open questions.

### How many categories people actually use, and why the evidence is thin

Bluntly: **there is no good study of how many categories people use in a task app before the set
stops helping.** I looked. What exists is adjacent research on email folders and desktop filing,
plus vendor blog posts, and I am not going to launder the adjacent research into a number for task
categories.

What is genuinely established is that people over-create containers and that the containers then
fail. [Whittaker and Sidner's email overload
work](https://www.researchgate.net/publication/221519353_Email_Overload_Exploring_Personal_Information_Management_of_Email)
found people spending around **10% of their email time on filing** and accumulating an average of
**244 folders**, and it introduced the idea of a **failed folder**: one whose name is too ambiguous
to be useful, or too specific to partition anything. Both failure modes are live here. Admin as it
stands is the ambiguous kind. A Travel category, which I considered and rejected below, would be the
too-specific kind, empty for ten months a year.

[Malone's 1983 desk study](https://dl.acm.org/doi/pdf/10.1145/357423.357430) is the origin of the
filers-versus-pilers distinction and of the finding that matters most here: **diligent filing does
not reliably improve retrieval, because hierarchical schemes have overlapping and therefore
ambiguous categories, and the cognitive difficulty of deciding on a scheme is itself a major factor
in how people organise.** Forty years on that is still the best available statement of the cost this
brief is trying to minimise.

On cognitive load, the number people reach for is Miller's seven plus or minus two, and it does not
mean what they think. [Cowan's 2001 reconsideration](https://philpapers.org/rec/COWTMN) put the
focus-of-attention limit at about **four chunks** and argued Miller's seven was a rhetorical device
rather than a measured capacity. Read straight, that cuts against a seven-item chip row rather than
for it. **I do not think it applies.** The chip row is a recognition task with all seven labels on
screen, not a recall task, and Cowan's limit concerns holding items in mind without support. Citing
Miller to justify seven would be wrong; citing Cowan to argue for four would be equally wrong. The
number should come from the colour constraint, which is measurable, rather than from working-memory
folklore.

The honest summary: the literature tells you that more containers cause misfiling and that ambiguous
containers fail, and it does not tell you where the line is. So the line gets drawn by the palette.

### Overlap, and whether the current seven really do hesitate

Two overlaps in the current set are worth taking seriously, and I reach opposite conclusions about
them.

**Health versus Exercise is a real overlap in the taxonomy and a false one in this app.** No
wellbeing framework splits them; the Wheel of Life has a single "health and fitness" segment and the
PWI a single "health" domain. On the taxonomy alone you would merge them. But look at what they hold
in `src/seed.ts`. Health holds "Register with a local GP", "Book the follow-up appointment" and "Book
the dental hygienist" - every one a `deadline` or `window` item driven by somebody else's calendar.
Exercise holds "Swim 3x a week" as a habit with a goal, plus a goal's worth of steps, plus a `buy`
item. Those are structurally different item shapes in an app whose whole model is `act`, the last
responsible moment. Health is things you must arrange; Exercise is things you must repeat. Ambiguous
cases exist, "start running again now the physio has cleared it", but they are rarer than the framing
suggests and the tie-breaker states in one line: **if someone else has to be booked it is Health, if
only you have to turn up it is Exercise.** Keep both. Also relevant:
`docs/design-brief-strava-gcal.md` contemplates an integration that would write into exactly one of
these, which makes Exercise the only category with a machine-writable future, and merging it away
would be expensive later.

**Admin as a catch-all is a real problem and the fix is not a split.** The obvious move is to carve
Money out of Admin, and I am against it for a specific reason: "Renew the insurance" and "Chase the
water bill" are both money and both admin, so the split creates a hesitation at exactly the
highest-volume point in the set, which is precisely Malone's failure mode. And Lifeboard already
encodes money structurally rather than categorically - `buy` items carry a `cost` and the Buy tab
rolls them into a budget via `buyHorizon()`. Adding a Money category duplicates a field with a
colour, and duplicate encodings are how a visual language stops meaning anything.

The real fix for Admin is threefold and none of it is a rename. First, it does not need to be the
catch-all, because **"Other" already is one**: an item with no category renders with a neutral
`var(--border)` edge and gets its own filter chip. Admin should mean bureaucracy specifically, and
anything genuinely none-of-the-above should be uncategorised. Second, **Admin is deliberately not
first in the list**, which matters because the same array feeds the chip row and the category
dropdown, and first position in a dropdown is where lazy filing goes. Third, **Admin keeps the
achromatic slate slot**, which is the right signal: it is the only category that is about paperwork
rather than about you, and the palette should say so.

**Events is the overlap nobody flagged, and it is the one I would cut.**

## What I would cut, and what I would add

**Cut Events.** It is the weakest of the seven and the argument is structural rather than a matter of
taste. "Events" names an item *shape*, not a life domain: a thing with a date, at a place, that you
have to be at. Lifeboard already encodes shape three separate times - in `kind`
(`deadline` / `window` / `blocked` / `habit` / `buy`), in `act` versus `due`, and in the Calendar view
which exists precisely to show what falls on a day. A category that re-encodes the type system is a
wasted colour slot. It also appears in none of the taxonomies above, for the same reason: it is not a
sphere of responsibility, it is a property of a task.

Look at what it holds. The seed uses it once, for "Book the restaurant", a `window` item whose whole
point is that the last responsible moment sits weeks before the event. Where do its contents go? A
dinner or a birthday goes to **People**, because the reason it is on your list is a person. The
passport you need renewed for the trip goes to **Admin**, where it always belonged. A gig you have
tickets for goes to Learning or nowhere, and if that bothers you it is the argument for an eighth
category, which is in the open questions.

**Add People.** This is the recommendation I hold most strongly and the one with the best citation
behind it. Every taxonomy checked has a relationships domain: WHOQOL's social relationships, the
PWI's personal relationships, the Wheel's relationships and family, VanderWeele's family, Headey and
Wearing's marriage plus friendship plus sex life, GTD's family, PARA's family and friends. [Cummins
found the satisfaction hierarchy dominated by
intimacy](https://link.springer.com/article/10.1007/BF00292050). And **the current seven do not name
a single person.** That is the biggest gap by a distance.

It is also the best fit with the app's actual mechanic, which is the argument that convinces me
rather than the citation. `act` is a last responsible moment, and almost every social obligation is
window-shaped in exactly that way: a present has to be bought before the birthday, a table booked
weeks before the dinner, a visit arranged before the weekend it is for, and a reply you owe decays
quietly rather than expiring. This is the class of task where the gap between when it is due and when
you must act is widest, which makes it the class Lifeboard is best at and the class most likely to
slip without it. Calling it People rather than Family or Social is deliberate: Family excludes
friends, Social sounds like Events again, People includes the colleague you owe an email.

**What I am not adding, and why.**

**Money or Finance.** Rejected on the duplicate-encoding argument above. Every taxonomy has a money
domain and this app has a better place to put it than a colour: cost is a field and the Buy tab is
the surface.

**Fun, Leisure or Recreation.** The closest call, and the likely eighth if there is one. It is in the
Wheel (fun and recreation), Headey and Wearing (leisure), WHOQOL (participation in recreation and
leisure) and PARA (hobbies), so the citation support is real. There is also an argument specific to
this app that I find genuinely persuasive: because category is the visual encoding, the colour
distribution across Today becomes a picture of your life, and a set with no slot for anything done
for pleasure guarantees that picture is chores. It loses on two grounds. Discretionary pleasure
generates few datable last responsible moments, so the category would be sparse, and it collides with
Learning, which is the same discretionary-growth impulse with more task volume behind it. Taking both
costs the colour budget. It is in the open questions.

**Travel.** PARA names it explicitly and it does generate real window-shaped work - flights, visas,
the passport. Rejected as Whittaker's too-specific failed folder: empty most of the year, and its
contents decompose cleanly into Admin (the paperwork), People (who you are going with) and Home (the
house-sitting). If you travel enough for that to be wrong, it is your call rather than the
literature's.

**Community, Spirituality, Safety, Emotional wellbeing.** All four are in the psychology instruments
and all four are absent from the productivity frameworks, and the tracker follows the productivity
frameworks. They generate reflection, not tasks.

**Anything shopping-shaped.** Apple ships twelve grocery categories and it works because supermarket
aisles are objective. Lifeboard's `buy` items already inherit the life domain that motivated them, and
the seed does this correctly without being told to: the kit bag is Exercise, the desk lamp and the
standing desk are Home. A Shopping category would be a third encoding of a fact already carried by
`buy` and by the Buy tab. Do not.

## How many there should be

**Seven, and the reason is the palette rather than the taxonomy.**

The taxonomy argument sets a floor and a soft ceiling and cannot pick a number inside them. Cummins's
seven ComQol headings absorbed 83% of the reported domain data; the surveyed range in that literature
runs from five to fifteen; Meyer's original wheel had six; WHOQOL collapses to four. Anything from
about five to about nine is defensible.

The filing argument pushes down. Malone's finding is that overlapping categories cause
misclassification and that deciding the scheme is itself costly; Whittaker's is that ambiguous
containers fail. Every category you add creates new adjacencies and therefore new hesitations, and
the marginal category is always the vaguest one, which is why the eighth item on anyone's list is
always something like "Personal" or "Misc". Lifeboard's escape hatch means the marginal category is
never necessary: an item that fits nowhere goes to Other and still appears on Today with a neutral
edge.

**The colour argument is decisive and it lands on seven.** Working from the ten `--cat-*` slots in
`src/index.css`, nine are chromatic and one, slate, is effectively achromatic at chroma 0.01. The nine
chromatic hues sit at 15, 55, 100, 160, 195, 230, 265, 305 and 340 degrees. Choose subsets and
maximise the smallest gap between any two chosen hues:

- **five chromatic hues** can be spaced with a minimum gap of 60 degrees (15, 100, 160, 230, 305)
- **six chromatic hues** manage 40 degrees at best (15, 55, 100, 160, 230, 305), and no six-subset
  does better
- **seven or more chromatic hues** cannot beat 35 degrees, because 35 is the smallest gap between
  neighbours in the list and any seventh hue splits one of the wide gaps into two narrow ones

So six chromatic hues plus slate is exactly seven categories at a minimum separation of 40 degrees,
and it is the largest set that clears 35. **Seven is not a compromise between the taxonomy and the
palette, it is the palette's own answer, and it happens to sit inside the taxonomy's comfortable
range.** An eighth category costs a 35-degree pair. Ten costs four of them, which is why the
`MAX_CATEGORIES = 10` comment in `categories.ts` is honest that the ceiling is a colour limit and
slightly optimistic that ten is usable.

Worth stating as a criticism of the current set: today's seven use six chromatic hues (15, 55, 160,
195, 265, 305) plus slate and have a minimum gap of **35**, because green at 160 and teal at 195 are
both in play. The current set therefore pays the eight-category colour penalty while only having
seven categories. That is a free win and it is the main reason three colours move.

## The colour constraint

**The recommended seven work, with one real cost and two things to watch.**

They take red 15, orange 55, yellow 100, green 160, blue 230, violet 305 and slate. Minimum
separation 40 degrees, the best achievable at this size. The three unused slots are **teal 195,
indigo 265 and pink 340**, and leaving those three specifically is the point: each sits 35 degrees
from something in the recommended set (teal from green and from blue, indigo from blue and from
violet, pink from violet and from red), so they are the three the defaults should not spend.
`nextColour()` walks `PALETTE` in declaration order and hands the first unused slot to a new
category, which means the eighth category a user creates gets teal. All three tail slots are equally
tight at a 35-degree minimum, so I have no basis for reordering `PALETTE` and would leave it alone.

**The hard part is not the palette, it is the size of the elements.** The category hue appears as a
3px or 4px card edge (`SHAPE` in `ItemCard.tsx` sets `edge` to 4 for lead cards and 3 for the rest),
a 6px calendar dot (`CalendarView.tsx`) and a 10px goal dot (`GoalsView.tsx`). Ware's rule for colour
coding is that [the smaller the area the less discriminable the colours, so small colour-coded areas
need *high* saturation while large background areas should stay
light](https://www.sciencedirect.com/topics/computer-science/saturation-color). Lifeboard cannot
follow that rule, and the reason is a good one: the `--cat-*` lightness values are pinned near 0.48
in light and near 0.72 in dark so that white text clears 4.5:1 on the active filter chip, and chroma
is correspondingly modest, 0.10 to 0.17 in light and 0.09 to 0.13 in dark. **Pinning lightness means
hue is the only channel carrying category identity**, on the smallest elements in the app, at chroma
levels well below what the perceptual advice wants. That is a deliberate trade of discriminability
for contrast compliance, and it is the reason the effective ceiling is nearer seven than ten.
`ItemCard.tsx` line 180 makes it slightly worse for one case: a flat card mixes the hue 55% with
`var(--border)`, dropping chroma further on exactly the low-emphasis cards there are most of.

**The state tokens squat in the warm arc.** `--now` sits at hue 42 and `--doing` at 75 in light, 50
and 80 in dark. Orange 55 is 13 degrees from `--now`, and yellow 100 is 20 to 25 degrees from
`--doing`. This matters because a started card replaces its category edge with the amber `--doing`
token (`ItemCard.tsx` line 173), so an orange-edged unstarted card and an amber-edged started card
are close neighbours on the same screen. It is not a regression, Events already owns orange today,
but it is why the two warm slots go to **Home** and **Learning**, the two lowest-traffic categories
in the set, rather than to People or Career. If the collision proves annoying the fix is to move the
started signal off the left edge, which is a different brief.

**Yellow is the weakest of the ten slots and the least theme-stable.** At the pinned lightness,
`oklch(0.48 0.1 100)` in light theme is a dark khaki that will not read as yellow, while
`oklch(0.77 0.13 100)` in dark theme is a proper yellow. Every other slot keeps its character across
themes; yellow changes it. That is unavoidable, because yellow's natural lightness is high and the
contrast rule pins it down, and it is precisely why yellow goes to Learning, the category with the
fewest items and the least need to be identified at a glance.

**One thing I have not verified and will not claim.** Red 15 and green 160 are both in the
recommended set, and red-green is the classic confusion axis for the roughly [8% of men with a
colour-vision deficiency](https://mk.bcgsc.ca/colorblind/palettes.mhtml). Because lightness is
pinned identically across all ten slots, the usual mitigation - differentiate by lightness as well as
hue - is unavailable by construction. I have not run a deuteranopia simulation over these ten oklch
values, so I am not going to assert that it is fine or that it is broken. It should be checked and
the check is cheap. For reference, Krzywinski's palette page treats **eight colours as the
conservative maximum** for categorical encoding that survives colour blindness, drawing on Bang
Wong's *Nature Methods* palette, and [ColorBrewer's qualitative schemes top out at
12](https://colorbrewer2.org/learnmore/schemes_full.html) with most stopping at 8 or 9. Both external
references put the safe ceiling below Lifeboard's ten and at or above the recommended seven.

## Ordering

The chip row on Today renders in array order and so does the category dropdown, which means the array
does two jobs with opposite incentives. In the chip row, early means reachable without scrolling. In
the dropdown, early means **where lazy filing lands**. The order has to serve both.

**Recommended order: Health, Exercise, Career, People, Home, Admin, Learning.**

The rule is descending expected volume, with two deliberate departures.

Admin is demoted. On volume alone it would be first or second, since it is the largest group in
`src/seed.ts`, and it goes sixth on purpose. Putting the broadest category at the top of the dropdown
is an invitation to file everything into it, which is the failure this brief exists to prevent.
Trading a little reach for filing discipline is worth it, and Admin is distinctive enough that you
will find it at position six.

Learning goes last because it is the most discretionary, and because if an eighth category is ever
added it will be Learning's neighbour in spirit and should sit beside it.

The order also has a colour job and it does it. Reading the chip row left to right the hues are red
15, green 160, blue 230, violet 305, orange 55, slate, yellow 100. **Every adjacent pair in the row is
at least 70 degrees apart.** The tightest pair in the whole set, red 15 and orange 55 at 40 degrees,
sits four chips apart, and the second tightest, orange 55 and yellow 100 at 45, is separated by slate.
Side-by-side comparison is the hardest test a small colour patch faces, and this ordering never asks
the eye to make a close one. That is the part of the recommendation I would be most reluctant to let
someone shuffle for aesthetic reasons.

## What this changes in the code

Small, and worth stating so the brief is checkable rather than aspirational.

`DEFAULT_CATEGORIES` in `src/lib/categories.ts` becomes the seven above in that order, with a new
`people` id replacing `events` and three `colour` values changed. `PALETTE` is unchanged.
`MAX_CATEGORIES` is unchanged, though an honest comment on it would now say that ten is the storage
ceiling and seven is the legible one.

The named aliases in the `:root` block of `src/index.css`, `--cat-health` through `--cat-learning`,
exist per their own comment for surfaces still reading a hue off a category id rather than off
`state.categories`. They need the same three colour reassignments plus the events-to-people rename.
Whichever surfaces still read them are the ones that will silently keep the old colours otherwise, so
finding them is part of the change rather than a follow-up.

Existing users are unaffected by construction: `categoriesOf()` returns `state.categories` when set
and only falls back to `DEFAULT_CATEGORIES` otherwise, so this changes what a new install starts with
and nothing else. There is no migration and there should not be one, because silently renaming
somebody's Events to People would be worse than leaving it.

## Open questions for the owner

**Whether there should be an eighth, and whether it is Fun.** Seven is the colour answer and eight is
defensible if you will spend a 35-degree hue pair on it. If you take an eighth, take Fun (or Leisure,
or whatever you would actually call it) on teal, and accept that teal and green will be close on a
6px dot. My lean is not to, on the grounds that a sparse discretionary category is the one that decays
into a graveyard. The counter-argument is real though: with no Fun slot the colour distribution on
Today is a permanent picture of chores, and that is a thing the app tells you every morning whether it
means to or not.

**Fun versus Learning, if you only want one.** They are the same discretionary impulse. Learning holds
goals, which is a first-class view, and that is why I kept it. If in practice your Learning category
holds one item that says "read the thing you saved", which is exactly what the seed has, then it is the
weaker of the two and they should swap.

**Whether Health and Exercise really do stay separate for you.** I have defended the split on the
structure of the items rather than the taxonomy, and no wellbeing framework agrees with me. The
tie-breaker I proposed is "if someone else has to be booked, it is Health". If you find yourself
hesitating more than once a week, merge them and free a slot, which would let you have People and Fun
both.

**Whether People is the right word.** Family excludes friends. Social sounds like Events, which is the
thing being cut. Relationships is too heavy for a chip. People is plain and slightly cold. Your call,
and the label is trivially renameable in Settings, so getting it wrong costs nothing.

**Whether Admin should be narrower and named as such.** I kept the vague name and fixed the problem by
demoting it in the order and by insisting Other is the real catch-all. The alternative is a sharper
name - Paperwork, Bureaucracy, Errands - which would make misfiling feel wrong but would also be less
honest about what you will actually put there. I lean to keeping Admin.

**Whether the chip row should hide empty categories.** Apple's grocery lists hide categories with
nothing in them, and Today's chip row could do the same, which would make a seven-item row feel like a
three-item row most days. It also means the row changes shape as you work and muscle memory for chip
position stops holding. A UI decision rather than a taxonomy one, and I have not thought it through.

**Whether a deuteranopia check changes anything.** Cheap to run and I have deliberately not guessed
the result. If red 15 and green 160 turn out to be genuinely confusable at 3px given the pinned
lightness, then Health and Exercise cannot both keep their colours and something has to move, most
likely Health to pink 340, with the knock-on that pink is 35 degrees from violet 305 and People would
have to move too. Worth knowing before the labels are settled rather than after.

**Whether the pinned-lightness rule is worth what it costs.** All ten slots sit at essentially the
same lightness so that white text clears 4.5:1 on the active filter chip. That is one surface. It
costs you the ability to differentiate categories by lightness on the three smallest surfaces in the
app, which is the mitigation the perceptual advice most wants. Letting lightness vary and finding
another way to make the active chip legible, a dark text variant or an outline rather than a fill,
would buy back real discriminability at every size. That is a bigger question than this brief and it
should be asked.
