"""Whether a send window has anything worth saying, and what it would say.

Pure, and it works on counts and calendar days alone. That is the privacy proposition
rather than a style choice: the dispatcher can say "4 missed" and has no way of knowing
which four, because the document it reads never held a title.

The counts are re-derived against the day the send happens rather than read off the
digest, because `pressure()` in `src/lib/dates.ts` is a function of the date *and* of
now. A digest written on Tuesday still knows the truth about Thursday; what it cannot
know is which day is today.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

SUPPORTED_VERSION = 1

# The client writes byDay from computedFor through computedFor + 21 days, so past that
# the document can say nothing about today and going stale is the more interesting fact.
HORIZON_DAYS = 21

# pressure() calls the next seven days 'soon', which is the lane TodayView labels
# "Start this week". The morning body counts that lane and nothing wider.
WEEK_DAYS = 7

MORNING = "morning"
EVENING = "evening"
SLOTS = (MORNING, EVENING)

DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class Unusable(Exception):
    """The digest cannot be read against this day, so nothing is sent.

    Not an error condition to alarm about: a client one version ahead, or a device shut
    for a month, both land here, and silence is the correct outcome for both.
    """


@dataclass(frozen=True)
class Counts:
    """Actionable work as at the send day, in the app's own three groups."""

    missed: int
    starting_today: int
    this_week: int

    @property
    def open_now(self) -> int:
        """What the evening asks about: overdue plus today's, still unstarted."""
        return self.missed + self.starting_today


def _day(value: Any) -> date | None:
    if not isinstance(value, str) or not DAY.match(value):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _count(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return 0
    return value


def _actionable(bucket: Any, weekday_open: bool) -> int:
    """A bucket's count, minus what the app itself has withdrawn for the day.

    `windowOpen()` takes weekday-only work off the actionable set at weekends, so a
    Sunday notification must not suggest the phone calls the app has already hidden.
    `weekdayOnly` is a subset of `all`, so this subtracts rather than adds.
    """
    if not isinstance(bucket, dict):
        return 0
    total = _count(bucket.get("all"))
    if weekday_open:
        return total
    return max(total - _count(bucket.get("weekdayOnly")), 0)


def counts_for(digest: Any, on: date) -> Counts:
    """Re-derive the app's groups from the histogram, for the day being sent on.

    Days between `computedFor` and `on` have had their start date come and go, so they
    join the missed count: that is the whole reason the client ships a histogram rather
    than the three numbers it could have collapsed them into.
    """
    if not isinstance(digest, dict):
        raise Unusable("digest is not an object")

    version = digest.get("version")
    if version != SUPPORTED_VERSION:
        # Refuse rather than guess. The client ships independently and will run ahead.
        raise Unusable(f"unrecognised version {version!r}")

    computed_for = _day(digest.get("computedFor"))
    if computed_for is None:
        raise Unusable("computedFor is not a calendar day")

    age = (on - computed_for).days
    if age < 0:
        raise Unusable(f"computedFor is {-age} days ahead of the send day")
    if age > HORIZON_DAYS:
        raise Unusable(f"digest is {age} days old")

    overdue = digest.get("overdue")
    by_day = digest.get("byDay")
    if not isinstance(overdue, dict) or not isinstance(by_day, dict):
        raise Unusable("overdue and byDay must both be objects")

    weekday_open = on.weekday() < 5
    week_end = on + timedelta(days=WEEK_DAYS)

    missed = _actionable(overdue, weekday_open)
    starting_today = 0
    this_week = 0
    for key, bucket in by_day.items():
        day = _day(key)
        if day is None:
            raise Unusable(f"byDay holds a key that is not a calendar day: {key!r}")
        count = _actionable(bucket, weekday_open)
        if day < on:
            missed += count
        elif day == on:
            starting_today += count
        elif day <= week_end:
            this_week += count

    return Counts(missed=missed, starting_today=starting_today, this_week=this_week)


def _morning(counts: Counts) -> dict[str, Any] | None:
    if counts.missed == 0 and counts.starting_today == 0:
        return None
    if counts.missed == 0:
        title = f"{counts.starting_today} to start today"
    elif counts.starting_today == 0:
        # `src/lib/notify.ts` has no wording for this one, and "4 missed, 0 start today"
        # is worse than saying only the half that is true.
        title = f"{counts.missed} missed"
    else:
        title = f"{counts.missed} missed, {counts.starting_today} start today"
    body = (
        f"{counts.this_week} more start this week."
        if counts.this_week > 0
        else "Nothing else this week."
    )
    return {"title": title, "body": body, "tag": "lifeboard-morning", "url": "/"}


def _evening(counts: Counts) -> dict[str, Any] | None:
    if counts.open_now == 0:
        return None
    return {
        "title": f"{counts.open_now} still open",
        "body": "Push them to tomorrow, or tick them off.",
        "tag": "lifeboard-evening",
        # The button navigates and never mutates: the worker holds no credentials, and a
        # button that rewrote the list from the shade could be neither seen nor undone.
        "url": "/?pass=missed",
        "actions": [{"action": "missed", "title": "Open What you missed"}],
    }


def notification(slot: str, counts: Counts) -> dict[str, Any] | None:
    """What to send, or None when this window has nothing worth an interruption.

    Two a day is a ceiling and not a quota, so this returning None is the feature: a
    clear day is a silent day, and a digest that arrives empty teaches you to swipe the
    next one away unread.
    """
    if slot == MORNING:
        return _morning(counts)
    if slot == EVENING:
        return _evening(counts)
    raise ValueError(f"slot must be one of {SLOTS}, got {slot!r}")


def for_device(note: dict[str, Any], max_actions: Any) -> dict[str, Any]:
    """Drop the action button on a device that has told us it cannot draw one.

    Only an explicit zero drops it. Safari reports nothing and ignores actions silently,
    which is the degraded form the design already accepts.
    """
    if "actions" not in note or not isinstance(max_actions, int) or isinstance(max_actions, bool):
        return note
    if max_actions >= 1:
        return note
    return {key: value for key, value in note.items() if key != "actions"}
