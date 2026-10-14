# Design brief: push notifications

## Why this exists

The ask was "ideally a couple of notifications per day", a nudge that helps rather than
nags, and research into what best practice actually says. This is that research plus a
design. Nothing here is built. `infrastructure/modules/push-scaffold/` already holds IAM,
a log group, a stub Lambda and a `DISABLED` EventBridge rule, all behind `enable_push`
which defaults to false, and its README is honest that the real work is missing: VAPID
keys, a subscription store, a Web Push client, and any logic that decides what is worth
interrupting someone for. This brief is that last part, and it changes one thing about the
scaffold that matters (see [Infrastructure](#infrastructure)).

Read alongside `src/lib/dates.ts`, which defines what "overdue" and "start today" mean,
and `src/views/review.ts`, which defines the What you missed pass. A notification must
speak in those terms and invent nothing.

**Where I have verified something from a source, it is linked. Where it is my judgement,
I say so.** The two are kept apart on purpose, because most writing about push
notifications is vendor content with an opt-in rate to sell.

## The recommendation

**Two scheduled digests a day, both suppressed when there is nothing to say. No per-item
reminders, ever.**

**Morning, 07:30 Europe/London.** The shape of the day, in the app's own words. Title
carries the count that matters most, body carries the rest.

> **4 missed, 2 start today**
> 3 more start this week.

If nothing is overdue, the title becomes `2 start today` and the missed clause disappears.
If nothing is overdue *and* nothing starts today, nothing is sent at all.

**Evening, 20:30 Europe/London.** One question, and the only notification with a button.

> **3 still open**
> Push them to tomorrow, or tick them off.
> [ Open What you missed ]

Sent only when something is overdue or was due to start today and is still live. A day
that closed clean gets silence.

The design move that makes "a couple a day" honest is that **two is a ceiling, not a
quota**. A clear week is a silent week. Every to-do app I looked at treats its daily
summary as unconditional, and that is exactly how a summary becomes wallpaper: if it
arrives when there is nothing in it, you learn to swipe it away without reading, and then
it fails on the day it mattered. That is my judgement, not a cited finding, but it follows
directly from the fatigue evidence below.

### The evidence

The single most useful study is [Fitz et al., *Batching smartphone notifications can
improve well-being*](https://www.sciencedirect.com/science/article/abs/pii/S0747563219302596)
(Computers in Human Behavior, 2019), a randomised field experiment with 237 participants.
It compared notifications as usual against batched delivery and against no notifications
at all. **Batching three times a day reduced stress, improved mood, and left people feeling
more productive and more in control of their phones.** Two findings from it matter more
than the headline: batching *hourly* produced almost no change against the control, and
turning notifications *off entirely* produced more anxiety and more fear of missing out
than leaving them on. So the shape being proposed here, a small number of predictable
batches, is the arm of that experiment that won, and the two obvious alternatives, "alert
me as things happen" and "no notifications, I'll open the app", are the two arms that lost.

Two a day sits just under the three that study used. My judgement is that three is right
for a phone's entire notification load and two is right for one app inside it, and that
the ask of "a couple" is already the correct instinct.

On volume, [Pielot and Church's in-situ study
(MobileHCI '14)](https://pielot.org/2014/07/an-in-situ-study-of-mobile-phone-notifications-mobilehci-14/)
logged **63.5 notifications a day** per participant and found that rising notification
counts, from email and social networks in particular, correlated with stress and feeling
overwhelmed, while personal communication did not. Their own recommendation for
professional contexts was reducing interruptions and *deferring* notifications. A task app
is structurally in the disruptive category rather than the welcome one, which argues for
spending its budget carefully.

On timing, the picture is less settled than vendor blogs imply. Research surveyed in
[*Intelligent Notification Systems*](https://arxiv.org/pdf/1711.10171) finds response
delays shorter at weekends and after midday, and a
[just-in-time mHealth trial](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12779098/) found
completion rates *lower* in the 07:00 to 12:00 window than in the afternoon or evening. So
the morning slot proposed here is, on the receptivity evidence alone, the worse of the two.
I am recommending it anyway, and the reason is my own: a morning digest is not asking for
an immediate action, it is asking you to load the day. The evening one, which does ask for
an action, sits in the window the evidence prefers. That is a deliberate trade and it is
worth revisiting if the morning one goes unread.

Be sceptical of the frequency numbers circulating outside the literature. Aggregators
report [an optimal band of 8 to 10 a day](https://www.drivingeco.com/en/notificaciones-cansan-fatiga-informativa-digital-dispara-segun-nuevo-estudio/)
and, on the same page as each other,
[3 or more a day actively harming the relationship](https://retenshun.com/blog/push-notification-frequency-sweet-spot).
These are marketing-tool vendors optimising for opens, not for whether the recipient is
better off, and the two figures contradict each other. The claim from that corner worth
keeping is the qualitative one, that relevance dominates frequency: a handful of relevant
notifications does not fatigue, and a couple of irrelevant ones does. That is consistent
with Pielot's finding on welcome versus disruptive categories, and it is the argument for
suppressing an empty digest.

### How comparable apps do it

The pattern across the field is **both**: per-item reminders driven by a time on the task,
plus one or two optional daily summaries. Lifeboard can only have the second half, and it
turns out the second half is what the apps' own defaults lean on.

[Todoist](https://www.todoist.com/help/articles/manage-your-notifications-in-todoist-QxQGXkMu)
is the closest match to what is proposed here. It sends a **"Morning overview" and an
"Evening review", once each per day, both with user-controlled timing**, alongside a daily
digest email. The morning-plus-evening pair is not my invention; it is what the most widely
used app in the category converged on.

[TickTick](https://blog.ticktick.com/2020/12/08/20-lesser-known-ticktick-features/) has a
single "Daily Notification" under Settings, Sounds & Notifications, at a time you choose,
with the ability to skip chosen days of the week. Notably it reports both what is done and
what is outstanding, and it can skip weekends. Both details are worth stealing; see the
open questions.

[Apple Reminders](https://support.apple.com/en-us/102484) has no digest but has the
relevant default: a reminder with a date and no time fires at **09:00**, configurable under
All-Day Reminders. That is the closest thing to an industry default time for "this is due
today" and it is later than the 07:30 proposed here.

[Things 3](https://culturedcode.com/things/support/articles/2803585/) is per-item only.
Reminders are short notifications rather than alarms, snoozable by 10, 30 or 60 minutes,
and it has no daily digest at all. It is the strictest app in the category and it chose the
opposite half from Lifeboard.

Google Tasks is the least interesting: reminders live in Google Calendar and behave like
calendar alerts.

What I take from the set: a morning summary at a configurable time is table stakes, an
evening counterpart is proven by Todoist, per-item reminders are how everyone else fills
the gap, and Lifeboard's privacy constraint means the summaries have to carry the whole
load rather than being a convenience layer over per-item alerts.

### What the platform supports in 2026

**Android Chrome, which is the target, is fully capable.** Push works in a browser tab and
in an installed PWA alike; no install is required. Up to **two action buttons** per
notification, feature-detectable via
[`Notification.maxActions`](https://web.dev/articles/push-notifications-display-a-notification),
which reports what the platform will actually render rather than what you may declare.
Action button icons are not drawn at all on Android 7 and later, so the buttons are text
only.

**iOS Safari requires the app to be installed to the Home Screen.** From the
[WebKit announcement](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/):
Web Push is for Home Screen web apps, meaning a manifest with `display` set to `standalone`
or `fullscreen`, which `public/manifest.webmanifest` already satisfies. Permission must
come from direct user interaction such as a subscribe button. An open Safari tab does not
count and never will. Notification **actions are not supported on Safari**, so the evening
notification's button is Android-only and the design must degrade to a bare notification
without it. Safari 18.4 added
[Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/), which
sends a JSON payload with no service worker involved; it is not needed here and adds a
second payload format to maintain, so I would ignore it.

**You cannot send a data-only push.** Both engines require every push to result in a
visible notification. Chrome will
[display "This site has been updated in the background"](https://pushpad.xyz/blog/this-site-has-been-updated-in-the-background)
on your behalf if you fail to show one, and WebKit requires `userVisibleOnly: true` on the
subscription. This closes off an otherwise appealing idea, using a silent push to refresh
state or update a badge without interrupting. It is not available. Every send costs the
user an interruption, which is another argument for suppressing empty ones.

**Permission prompts.** [web.dev's Permission UX
guidance](https://web.dev/articles/push-notifications-permissions-ux) is unambiguous: the
worst thing you can do is prompt on landing, and you should never ask as soon as the user
opens the site. [MDN's `requestPermission()`
page](https://developer.mozilla.org/en-US/docs/Web/API/Notification/requestPermission_static)
states the request should be made in response to user interaction and demonstrates it
inside a click handler. There is a hard consequence to getting this wrong: once a user
blocks, the page can never ask again, and recovery requires the user to change it in
browser settings. Chrome and Firefox additionally route sites with low opt-in rates, and
sites that prompt without a user gesture, into a
[quieter permission UI](https://developer.chrome.com/blog/permissions-chip) that suppresses
the prompt entirely. So the cost of a badly timed prompt is not a declined request, it is
a permanently closed door.

## The digest contract

The client writes `users/{identityId}/digest.json` alongside the existing
`users/{identityId}/state.json`, on the same flush that `src/lib/sync.ts` already performs.
No new write path, no new IAM: the authenticated role's policy in
`infrastructure/modules/user-data/main.tf` already covers
`users/${cognito-identity.amazonaws.com:sub}/*`, so this key is writable today.

```json
{
  "version": 1,
  "computedFor": "2026-08-19",
  "overdue": { "all": 4, "weekdayOnly": 1 },
  "byDay": {
    "2026-08-19": { "all": 2, "weekdayOnly": 0 },
    "2026-08-21": { "all": 1, "weekdayOnly": 1 },
    "2026-08-22": { "all": 3, "weekdayOnly": 0 }
  },
  "chronic": 2
}
```

Five fields. Every one of them is a count or a date. There is no string in this document
that a person typed.

**`version`** (number). Forward compatibility. The notifier refuses a version it does not
recognise rather than misreading it, which matters because the client and the Lambda ship
independently and the client will be ahead. Zero privacy cost.

**`computedFor`** (`Day`, `YYYY-MM-DD`). The local calendar day the counts were derived
against, produced by `today()` from `src/lib/dates.ts`. This is the field that makes the
document durable. Without it the notifier cannot tell a fresh digest from a four-day-old
one, and would report "2 start today" about a Tuesday that has been and gone. It also lets
the notifier derive staleness on its own, which is why there is deliberately no
`writtenAt` instant here. Privacy cost: it reveals roughly when the app was last opened,
which S3's own `LastModified` reveals anyway, so refusing an explicit timestamp is
cosmetic. Being cosmetic, it costs nothing to refuse.

**`overdue`** (`{ all, weekdayOnly }`). The count of live, unblocked, daily items whose
`act` is before `computedFor`, which is exactly `reviewBatch()` in
`src/views/review.ts` reduced to a number. `weekdayOnly` is the subset of `all` carrying
`item.weekdaysOnly`, **not an additional count**. It exists so the notifier can reproduce
`windowOpen()` and not tell you on a Sunday to make phone calls that the app itself has
already withdrawn from the actionable set. Privacy cost: how far behind you are. This is
the field the whole feature exists for.

**`byDay`** (map of `Day` to `{ all, weekdayOnly }`). Live, unblocked, daily items grouped
by their `act` date, covering `computedFor` through `computedFor + 21` days. Days with no
items are omitted. This is the field that earns its place hardest, so the reasoning in
full: `pressure()` is a function of `act` *and* of now, so any pre-collapsed bucket
("slipped", "now", "soon") is only true on the day it was written. A day-keyed histogram
lets the notifier call the same derivation the app calls, for whatever today actually is,
and stay correct for three weeks of the app not being opened. Beyond three weeks, the
digest going stale is itself the more interesting fact. The alternative, having the client
pre-render the notification strings, was tempting and is wrong: it would freeze the
notification at the moment of the last app open, which is precisely the case where the
notification is most needed and most wrong.

Privacy cost, stated plainly: this is a three-week histogram of your workload. It shows
that you have a heavy Thursday and a clear weekend. It shows nothing about what any of it
is. My judgement is that this is a real cost and a small one, and that it is unavoidable
if a server is going to say anything true about your dates. Twenty-one days rather than
seven is a slightly larger cost for a much longer staleness tolerance; seven would also
work and would be defensible if he wants the tighter version.

**`chronic`** (number). Live items with `item.slips >= 3`, the same threshold
`src/lib/summary.ts` uses to surface "moved N times" as a fact on the card. It exists so
the evening notification can distinguish "you have three things left" from "you have three
things left and two of them you have already pushed three times", which is the difference
between something needing an hour and something needing a decision. **This is the most
arguable field in the document.** It is the only one that is not a plain fact about time,
and a count of your own repeated failures to start something is the field most likely to
read as a rebuke. It is in the open questions.

### What is deliberately not in it

No titles, no descriptions, no notes, no categories, no goal names, no costs, no item ids,
no timezone, no device information, no engagement or read receipts. Categories were the
closest call: category counts would let the notifier say "mostly admin", which is a nicer
sentence, but a category set is user-authored content and its names are as revealing as
task titles. Costs and the Buy tab are absent because nothing in the recommendation needs
them. Timezone is absent because the schedule handles it (see below), so the server never
needs to know where you are.

### Freshness and its one known error

The digest is as current as the last sync flush, and `src/lib/sync.ts` flushes on every
edit and on every launch, so in normal use it is minutes old. Two known inaccuracies,
both stated rather than hidden. First, an item whose `unblocks` date passes between the
write and the send is excluded from the counts, because blockedness is evaluated at write
time and `isBlocked()` cannot be reproduced from a histogram. It undercounts by one and
self-corrects on the next app open. Second, an item more than 21 days out that rolls into
the window during a long absence is not counted. Both errors run in the direction of
saying too little, which is the correct direction for a notification to be wrong in.

## The permission flow

**Never on load.** No call to `Notification.requestPermission()` from `src/lib/pwa.ts` or
from anywhere in the boot path. Nothing about opening a task app implies wanting to be
interrupted by it, and the penalty for asking anyway is permanent, per web.dev above.

**Ask at the gesture that means "remind me later".** That gesture already exists and it is
specific: tapping Tomorrow or Next week in the What you missed pass. `ReviewView.tsx`
already has those three buttons, and `reviewDeferredOn` in the state already records that
the pass was pushed. Someone who defers overdue work is telling you, in the app's own
vocabulary, that they want to be reminded. That is the intent signal.

Gate it so it fires once and only on a pattern rather than a one-off: the pre-prompt
appears the second time the pass is deferred on a *different* day, and only when
`Notification.permission === 'default'`.

**The pre-prompt is the app's own sheet, not the browser's.** This is the double opt-in
pattern web.dev recommends, and its purpose is that a refusal stays recoverable.

> **Two notifications a day**
>
> A line each morning on what you missed and what starts today, and one in the evening if
> anything is still open. Nothing else, and nothing at all when the list is clear.
>
> [ Not now ]  [ Turn them on ]

Only `Turn them on` calls `requestPermission()`, synchronously inside that click handler,
so the browser sees a real user gesture. `Not now` closes the sheet, records that it was
declined, and never shows it again from the review pass.

**A row in Settings is the permanent path**, and it is the only path after a refusal.
`SettingsView.tsx` has groups for Your list, Display and sound, Sync and Your data;
Reminders belongs as its own group rather than buried in Display and sound, because it is
the only setting with a server on the other end of it. The row re-reads
`Notification.permission` on mount so it reflects reality rather than a cached flag, and
renders four states:

- **`default`** - a plain toggle. Turning it on runs the same pre-prompt then request.
- **`granted`** - on, with the two times shown and an off switch. Off unsubscribes and
  removes the subscription record; it does not merely stop showing notifications, because
  a subscription nobody wants should not sit on a push service.
- **`denied`** - "Blocked in your browser", with one line of instruction to change it in
  site settings, and no button, because there is nothing the page can do. web.dev is
  explicit that the page cannot ask again.
- **iOS Safari, not installed** - "Add Lifeboard to your Home Screen first, then come
  back", detected from `display-mode: standalone` not matching. A dead toggle here is
  worse than no toggle, because the failure is invisible and the user concludes the
  feature is broken.

**On a later change of mind**, unblocking in Chrome's site settings flips
`Notification.permission` back to `default`, the Settings row picks that up on next mount,
and the toggle becomes live again. Nothing needs to be remembered across that.

## Infrastructure

### The one change the scaffold needs

`infrastructure/modules/push-scaffold/main.tf` currently grants the dispatcher role
`s3:GetObject` on `${user_data_bucket_arn}/users/*` and `s3:ListBucket` with an
`s3:prefix` condition of `users/*`. **That reads `state.json`, which is every task title
the user has ever written.** It is a reasonable IAM shape for the design the scaffold was
written against and it is incompatible with the privacy decision. The read statement
becomes:

```
Resource = [
  "${var.user_data_bucket_arn}/users/*/digest.json",
  "${var.user_data_bucket_arn}/users/*/push/*",
]
```

A wildcard in the middle of a key is valid in an S3 resource ARN, so this genuinely cannot
name `state.json`. The module README should say so where it currently says the dispatcher
would need to read state documents.

### Subscriptions: S3, not DynamoDB

Store each subscription as `users/{identityId}/push/{endpointSha256}.json`, holding the
endpoint, the `p256dh` and `auth` keys from
`PushSubscription.toJSON()`, and whether it is enabled.

The reason is that this needs no new infrastructure at all. The client can already write
that key: the authenticated role covers the whole of `users/{sub}/*`, and
`src/lib/sync.ts` already has an S3 transport. A DynamoDB table would need a table, a
subscription API to write to it (the browser cannot be given table access scoped by
identity as cleanly as S3 keys are), a Lambda behind that API, and a JWT authorizer, which
is the entire `capture-api` module rebuilt for something the browser can already do. The
subscription record is per-user data living under the per-user prefix that is already
correctly locked down. Buying nothing beats building an API.

The one wart: the authenticated role deliberately omits `s3:DeleteObject`, so the client
cannot delete its own subscription when the user turns notifications off. It writes
`{"enabled": false}` over it instead, which matches how the app soft-deletes everything
else. The notifier skips disabled records.

Keying by SHA-256 of the endpoint rather than the endpoint itself keeps a URL containing a
device-scoped token out of key names, log lines and `ListObjectsV2` output.

### VAPID keys

Two SSM parameters, following the `capture-api` pattern in
`infrastructure/modules/capture-api/README.md` exactly: a `SecureString` at
`{secret_prefix}/{environment}/vapid-private-key` and a `String` at
`{secret_prefix}/{environment}/vapid-public-key`, both created holding `REPLACE_ME` with
`lifecycle.ignore_changes = [value]` and populated by hand after the first apply. Generate
the pair locally with `py-vapid` or `openssl ecparam -name prime256v1 -genkey`; nothing
about VAPID needs an AWS or Apple account.

Encrypt with the default `alias/aws/ssm` key so no `kms:Decrypt` statement is needed on
the role, for the same reason capture-api gives. The Lambda reads the private key once per
cold start.

The public key also has to reach the browser, as the `applicationServerKey` argument to
`pushManager.subscribe()`. It is public by construction, so it ships as a build-time
`VITE_VAPID_PUBLIC_KEY` in `.env`, alongside `VITE_SYNC_BUCKET`. Rotating VAPID keys
invalidates every existing subscription, so treat it as a one-time generation.

### The schedule

Two `aws_scheduler_schedule` resources (EventBridge Scheduler, not a classic
`aws_cloudwatch_event_rule`) with `schedule_expression_timezone = "Europe/London"`:
`cron(30 7 * * ? *)` and `cron(30 20 * * ? *)`, each passing a `{"slot": "morning"}` or
`{"slot": "evening"}` payload to the same Lambda.

The timezone attribute is the reason for Scheduler over the classic rule the scaffold
uses. [Scheduler evaluates a named IANA zone and handles daylight saving
itself](https://docs.aws.amazon.com/scheduler/latest/UserGuide/schedule-types.html), so
07:30 stays 07:30 through the BST transition, skips a nonexistent spring-forward time, and
fires a repeated autumn time once rather than twice. A classic UTC cron would drift an
hour for half the year, and the alternative fix, sweeping every 30 minutes and matching
against a client-written slot, means 48 invocations a day instead of 2 to correct one hour
twice a year. The trade is that the times become Terraform variables rather than in-app
settings, and changing them needs an apply. For one user that is the right side of the
trade; see the open questions.

### The handler

Python 3.12, packaged by a `build.sh` mirroring
`infrastructure/lambdas/parse_capture/build.sh`, with `pywebpush` as the only dependency.
Per invocation: list `users/`, and for each identity read its `push/` records and its
`digest.json`, reject an unknown `version`, recompute the app's own buckets from `byDay`
and `overdue` against the real today and the real weekday, apply the suppression rule for
the slot, and send.

Suppression is the whole product, so it belongs in one place and should be the most tested
function in the handler. Morning sends when `missed > 0 or startToday > 0`. Evening sends
when `missed + startToday > 0`. Both otherwise return without sending, which is the normal
case on a clear day and must not be logged as an error.

The evening payload carries one action, feature-gated on the client having reported
`Notification.maxActions >= 1`:

```json
{ "actions": [{ "action": "missed", "title": "Open What you missed" }] }
```

**That button navigates; it does not mutate.** `notificationclick` in the service worker
calls `clients.openWindow('/?pass=missed')` and the app opens on the review pass. It does
not defer anything and it does not tick anything off. Two reasons. The practical one is
that the service worker has no Cognito credentials, so writing state from it means building
a second auth path with token refresh inside a worker. The design one is that a button
which silently rewrites your list from the notification shade gives you no way to see what
it did or undo it, and the app already has a good screen for exactly this decision. One
tap to arrive, one tap to defer, and you saw what you deferred.

### Dead devices

[404 and 410 from a push service are permanent](https://pushpad.xyz/blog/web-push-error-410-the-push-subscription-has-expired-or-the-user-has-unsubscribed):
the subscription is gone, whether because the user revoked permission, cleared site data,
or uninstalled the PWA. On either code the notifier deletes the subscription object. So an
uninstalled device costs exactly one wasted send and then disappears; nothing needs to
detect the uninstall.

This is the one place the notifier gets write access to a user prefix, and it must be
scoped to `s3:DeleteObject` on `users/*/push/*` only, never `users/*`. It cannot then touch
`state.json` or `digest.json`, which is the property worth preserving.

Treat 429 as transient and skip; the next slot is twelve hours away, so there is no need
for a retry queue. The service worker should also handle `pushsubscriptionchange` by
re-subscribing and writing a new record, though Chrome's support for that event has been
patchy and the practical recovery is that the next app open re-subscribes.

### Cost

Effectively zero, and worth naming the lines so the claim is checkable. Web Push over VAPID
is free: the FCM and `*.push.apple.com` endpoints charge nothing and need no account.
EventBridge Scheduler at 2 invocations a day is 60 a month against a per-million price.
Lambda at 60 invocations a month, a second or two each at 256 MB, is roughly 30 GB-seconds
against the perpetual 400,000 GB-second free tier. S3 is around 180 GET and LIST requests
a month, which does not reach a penny. Standard SSM parameters are free. The only line that
could ever bill is CloudWatch Logs storage, and 30-day retention on two invocations a day
of a handler that mostly returns immediately will not approach the free 5 GB. **Call it
£0.00 a month, with CloudWatch the only thing to watch if the handler ever starts logging
per-item detail, which it must not, because per-item detail is the thing this design does
not have.**

## What I would not build

**Per-item reminders.** The obvious feature, and it is foreclosed. A notification naming an
item needs the item's title on the server, and the privacy decision says the server does
not read task content. There is a second reason that would apply even without the first:
`act` is a last responsible moment, not an appointment. "Start in 3d" is not a thing that
happens at 09:00, and firing an alert as though it were would break the model the app is
built on. Todoist and TickTick can do per-item reminders because they hold your content and
because they ask you for a clock time. Lifeboard does neither.

**A "Done" button on the notification.** Frequently requested, and impossible here for a
clean reason: the digest holds counts, so there is no item identity in the payload to mark
done. Building it means putting item ids and titles in the digest, which is the whole
constraint. Rejected on the constraint, not on taste.

**Goal nudges.** `goalProgress()` already computes `idle`, days since anything on a goal was
completed, and "Get fit has not moved in three weeks" is a genuinely good notification. It
needs the goal title. A count of idle goals without their names is not actionable, so this
is either a privacy breach or useless. Rejected.

**Buy and budget notifications.** `buyHorizon()` thinks in calendar months. A monthly
notification is not the thing being asked for, and the Buy tab is a browse surface rather
than a deadline surface. Nothing to nudge.

**Adaptive or learned timing.** The literature on optimal-moment delivery is real, and
every approach in it needs per-notification engagement telemetry, which means the server
learning when you pick up your phone and what you respond to. That is a far larger privacy
cost than a date histogram, for a gain measured against random timing rather than against
a sensibly chosen fixed time. Two fixed times he can change is the better answer.

**A third, midday notification.** Fitz et al. used three batches, so there is evidence for
it. Two is the ask, and the third would land in the working day where it is least welcome
and most likely to be the one that turns the set into noise. Add it only if the evening
one is proving too late to act on.

**Streak and completion notifications.** `docs/design-brief-strava-gcal.md` already ruled
out Strava's celebratory layer for this app, and the same reasoning applies. A completion is
acknowledged by the chime and the strike-through, in the app, at the moment it happens.
Telling someone by push that they did something they know they did is spending an
interruption on nothing.

**An email digest.** A second channel, a second failure mode, and unlike a notification the
counts then sit in an inbox indefinitely.

**The Badging API.** `navigator.setAppBadge()` works on Android and is
[supported on iOS Home Screen web apps](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/),
and it is the cheapest thing on this list to add. Rejected anyway: a number stuck on the
icon is ambient pressure that cannot be dismissed, only cleared by doing the work, and it
would need a push to update it, which costs a notification anyway. Two interruptions a day
that you can swipe away is a kinder design than a permanent count. This is a judgement and
he may disagree.

**Anything at all when the list is clear.** Stated again because it is the easiest thing to
lose during implementation. The suppression branch is a feature and it needs a test.

## Open questions for the owner

**The times.** 07:30 and 20:30 are guesses. Apple's default for an all-day reminder is
09:00 and the receptivity evidence prefers the afternoon to the morning. What is the actual
boundary of your morning, and is 20:30 late enough to be a review but early enough to act
on?

**`chronic`.** Is a count of items you have pushed three or more times a useful signal or a
rebuke? It is the one field in the digest that is about you rather than about the calendar,
and I can drop it without touching anything else.

**Weekends.** TickTick lets you skip chosen days and does so precisely because a work
summary on a Saturday is noise. `weekdaysOnly` already exists per item and the digest
carries it, so a phone call will not be suggested on a Sunday, but the notification itself
has no weekend concept. Suppress both at weekends, suppress the evening only, or leave them
on?

**In-app time control.** Recommending EventBridge Scheduler with a named timezone means the
times are Terraform variables, and changing them is an apply. Making them adjustable in
Settings means a 30-minute sweep, 48 Lambda invocations a day instead of 2, still free but
noisier. Is a `terraform.tfvars` change acceptable for something you will set once?

**Multiple devices.** Phone plus a desktop browser means two subscriptions. Send to both,
or only to the most recently active one? Both is simpler and correct if the phone is the
only one you actually carry; if you keep a desktop tab open all day, both will be annoying.

**The evening notification when nothing has moved.** If the morning said "3 missed" and
nothing changed all day, the evening will say the same thing back to you. That is either
the most useful nudge of the pair or the most irritating, and I do not think I can tell
which from the outside.

**Whether the morning one earns its place at all.** The evidence is weakest for the morning
slot, and the honest minimal version of this design is one notification a day in the
evening, carrying the action, with the morning one added later if the day keeps starting
badly. If you want the smallest thing that could work, that is it.
