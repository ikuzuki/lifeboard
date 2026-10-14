"""The suppression rule and the counts it runs on.

Suppression is the whole product, so this is the file that matters: two a day is a
ceiling, and a day with nothing to say has to end in silence rather than in a digest
nobody reads. Standard library only, and nothing here touches AWS or a push service.

    python -m pytest infrastructure/lambdas -q
"""

from __future__ import annotations

import importlib.util
import sys
from datetime import date
from pathlib import Path

import pytest

_spec = importlib.util.spec_from_file_location(
    "push_dispatch_digest", Path(__file__).parent / "digest.py"
)
digest = importlib.util.module_from_spec(_spec)
# Registered before exec: a frozen dataclass resolves its own module during creation.
sys.modules[_spec.name] = digest
_spec.loader.exec_module(digest)

# A Wednesday, so the ordinary case is a weekday and the weekend cases have to be asked
# for explicitly.
WEDNESDAY = date(2026, 8, 19)
SATURDAY = date(2026, 8, 22)
SUNDAY = date(2026, 8, 23)


def doc(
    computed_for: str = "2026-08-19",
    overdue: dict[str, int] | None = None,
    by_day: dict[str, dict[str, int]] | None = None,
    version: object = 1,
    chronic: int = 0,
) -> dict[str, object]:
    return {
        "version": version,
        "computedFor": computed_for,
        "overdue": overdue or {"all": 0, "weekdayOnly": 0},
        "byDay": by_day or {},
        "chronic": chronic,
    }


def bucket(all_: int, weekday_only: int = 0) -> dict[str, int]:
    return {"all": all_, "weekdayOnly": weekday_only}


# -----------------------------------------------------------------------------
# Documents the notifier refuses
# -----------------------------------------------------------------------------
def test_refuses_a_version_it_does_not_recognise():
    """The client ships independently and will run ahead. Misreading it is worse."""
    with pytest.raises(digest.Unusable, match="unrecognised version"):
        digest.counts_for(doc(version=2, overdue=bucket(4)), WEDNESDAY)


def test_refuses_a_digest_older_than_the_histogram_it_carries():
    stale = doc(computed_for="2026-07-01", overdue=bucket(4))
    with pytest.raises(digest.Unusable, match="49 days old"):
        digest.counts_for(stale, WEDNESDAY)


def test_reads_a_three_week_old_digest_because_that_is_what_the_horizon_is_for():
    twenty_one = doc(computed_for="2026-07-29", overdue=bucket(4))
    assert digest.counts_for(twenty_one, WEDNESDAY).missed == 4


def test_refuses_a_digest_written_for_a_day_that_has_not_happened():
    ahead = doc(computed_for="2026-08-20", overdue=bucket(4))
    with pytest.raises(digest.Unusable, match="ahead of the send day"):
        digest.counts_for(ahead, WEDNESDAY)


@pytest.mark.parametrize(
    "broken",
    [
        "not a document",
        {"version": 1, "computedFor": "yesterday", "overdue": {}, "byDay": {}},
        {"version": 1, "computedFor": "2026-08-19", "overdue": 4, "byDay": {}},
        {"version": 1, "computedFor": "2026-08-19", "overdue": {}, "byDay": []},
        {"version": 1, "computedFor": "2026-08-19", "overdue": {}, "byDay": {"soon": {"all": 1}}},
    ],
)
def test_refuses_a_malformed_document(broken):
    with pytest.raises(digest.Unusable):
        digest.counts_for(broken, WEDNESDAY)


# -----------------------------------------------------------------------------
# Counting against the real today
# -----------------------------------------------------------------------------
def test_a_start_day_that_has_been_and_gone_counts_as_missed():
    """Why the client ships a histogram: a digest goes on being right for three weeks."""
    counts = digest.counts_for(
        doc(
            computed_for="2026-08-17",
            overdue=bucket(1),
            by_day={"2026-08-17": bucket(2), "2026-08-18": bucket(1), "2026-08-19": bucket(3)},
        ),
        WEDNESDAY,
    )
    assert (counts.missed, counts.starting_today) == (4, 3)


def test_this_week_is_the_next_seven_days_and_stops_there():
    counts = digest.counts_for(
        doc(
            by_day={
                "2026-08-19": bucket(1),
                "2026-08-20": bucket(2),
                "2026-08-26": bucket(1),
                "2026-08-27": bucket(5),
            }
        ),
        WEDNESDAY,
    )
    assert (counts.starting_today, counts.this_week) == (1, 3)


def test_weekday_only_work_is_withdrawn_at_the_weekend():
    """windowOpen() hides it in the app, so the notification must not offer it."""
    document = doc(
        computed_for="2026-08-21",
        overdue=bucket(3, 2),
        by_day={"2026-08-22": bucket(2, 1)},
    )
    weekend = digest.counts_for(document, SATURDAY)
    assert (weekend.missed, weekend.starting_today) == (1, 1)

    weekday = digest.counts_for(document, date(2026, 8, 21))
    assert weekday.missed == 3


# -----------------------------------------------------------------------------
# The suppression rule
# -----------------------------------------------------------------------------
def test_an_empty_digest_says_nothing_in_either_window():
    counts = digest.counts_for(doc(), WEDNESDAY)
    assert digest.notification(digest.MORNING, counts) is None
    assert digest.notification(digest.EVENING, counts) is None


def test_a_sunday_of_only_weekday_only_work_stays_silent():
    """The one case where a non-empty digest still has nothing worth saying."""
    counts = digest.counts_for(
        doc(
            computed_for="2026-08-21",
            overdue=bucket(2, 2),
            by_day={"2026-08-23": bucket(1, 1)},
        ),
        SUNDAY,
    )
    assert counts.open_now == 0
    assert digest.notification(digest.MORNING, counts) is None
    assert digest.notification(digest.EVENING, counts) is None


def test_work_further_out_alone_is_not_worth_a_morning():
    counts = digest.counts_for(doc(by_day={"2026-08-21": bucket(4)}), WEDNESDAY)
    assert counts.this_week == 4
    assert digest.notification(digest.MORNING, counts) is None


def test_the_morning_sends_on_overdue_alone_and_on_today_alone():
    overdue_only = digest.counts_for(doc(overdue=bucket(4)), WEDNESDAY)
    today_only = digest.counts_for(doc(by_day={"2026-08-19": bucket(2)}), WEDNESDAY)
    assert digest.notification(digest.MORNING, overdue_only) is not None
    assert digest.notification(digest.MORNING, today_only) is not None


def test_the_morning_leads_with_what_was_missed():
    counts = digest.counts_for(
        doc(overdue=bucket(4), by_day={"2026-08-19": bucket(2), "2026-08-21": bucket(3)}),
        WEDNESDAY,
    )
    note = digest.notification(digest.MORNING, counts)
    assert note["title"] == "4 missed, 2 start today"
    assert note["body"] == "3 more start this week."


def test_a_clear_morning_says_nothing_about_missing_anything():
    counts = digest.counts_for(doc(by_day={"2026-08-19": bucket(2)}), WEDNESDAY)
    note = digest.notification(digest.MORNING, counts)
    assert note["title"] == "2 to start today"
    assert note["body"] == "Nothing else this week."


def test_a_morning_with_nothing_starting_says_only_the_true_half():
    counts = digest.counts_for(doc(overdue=bucket(4)), WEDNESDAY)
    assert digest.notification(digest.MORNING, counts)["title"] == "4 missed"


def test_the_evening_asks_about_overdue_and_todays_together():
    counts = digest.counts_for(
        doc(overdue=bucket(2), by_day={"2026-08-19": bucket(1), "2026-08-24": bucket(9)}),
        WEDNESDAY,
    )
    note = digest.notification(digest.EVENING, counts)
    assert note["title"] == "3 still open"
    assert note["body"] == "Push them to tomorrow, or tick them off."


def test_only_the_evening_carries_a_button_and_it_only_navigates():
    counts = digest.counts_for(doc(overdue=bucket(1)), WEDNESDAY)
    evening = digest.notification(digest.EVENING, counts)
    assert evening["actions"] == [{"action": "missed", "title": "Open What you missed"}]
    assert evening["url"] == "/?pass=missed"
    assert "actions" not in digest.notification(digest.MORNING, counts)


def test_an_unknown_slot_is_a_deploy_fault_rather_than_a_quiet_day():
    with pytest.raises(ValueError, match="slot must be one of"):
        digest.notification("midday", digest.counts_for(doc(overdue=bucket(1)), WEDNESDAY))


def test_a_payload_holds_nothing_but_counts_and_fixed_copy():
    counts = digest.counts_for(doc(overdue=bucket(4), chronic=2), WEDNESDAY)
    note = digest.notification(digest.EVENING, counts)
    assert set(note) == {"title", "body", "tag", "url", "actions"}


# -----------------------------------------------------------------------------
# Per-device degradation
# -----------------------------------------------------------------------------
def test_a_device_that_reports_no_actions_gets_the_notification_without_one():
    note = digest.notification(
        digest.EVENING, digest.counts_for(doc(overdue=bucket(1)), WEDNESDAY)
    )
    assert "actions" not in digest.for_device(note, 0)
    assert "actions" in digest.for_device(note, 2)
    # Safari reports nothing at all and drops actions silently, which is the accepted
    # degraded form rather than a reason to withhold the button from Android.
    assert "actions" in digest.for_device(note, None)
