"""Cap arithmetic and the two-cap policy. No AWS: the two reads are stubbed."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_spec = importlib.util.spec_from_file_location(
    "parse_capture_budget", Path(__file__).parent / "budget.py"
)
budget = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(budget)


@pytest.fixture(autouse=True)
def _configured(monkeypatch):
    monkeypatch.setattr(budget, "TABLE_NAME", "lifeboard-dev-capture-usage")
    monkeypatch.setattr(budget, "GLOBAL_LIMIT_USD", 5.0)
    monkeypatch.setattr(budget, "USER_LIMIT_USD", 2.0)


def _spend(monkeypatch, total: float, mine: float) -> None:
    monkeypatch.setattr(budget, "spend", lambda subject=None: mine if subject else total)


def test_a_capture_costs_a_fraction_of_a_penny():
    # 350 in, 300 out on Haiku: the shape of a real dump.
    cost = budget.cost_usd(350, 300, "claude-haiku-4-5")
    assert cost < 0.003


def test_an_unknown_model_is_priced_as_the_dearest():
    assert budget.cost_usd(1000, 1000, "who-knows") == budget.cost_usd(1000, 1000, "claude-opus-5")


def test_allows_when_both_caps_have_room(monkeypatch):
    _spend(monkeypatch, total=1.0, mine=0.5)
    budget.check_available("user-a")


def test_blocks_on_the_global_cap_even_if_the_user_has_room(monkeypatch):
    _spend(monkeypatch, total=5.0, mine=0.0)
    with pytest.raises(budget.BudgetExceeded, match="the monthly cap"):
        budget.check_available("user-a")


def test_blocks_one_user_while_the_global_cap_has_room(monkeypatch):
    """The reason two caps exist: a global cap alone lets one account take the lot."""
    _spend(monkeypatch, total=2.5, mine=2.0)
    with pytest.raises(budget.BudgetExceeded, match="your monthly cap"):
        budget.check_available("greedy")


def test_an_anonymous_caller_is_only_held_to_the_global_cap(monkeypatch):
    _spend(monkeypatch, total=1.0, mine=99.0)
    budget.check_available(None)


def test_the_two_caps_use_different_rows():
    assert budget.row_key() == budget.current_month()
    assert budget.row_key("abc") == f"{budget.current_month()}#abc"


def test_does_nothing_at_all_when_no_table_is_configured(monkeypatch):
    monkeypatch.setattr(budget, "TABLE_NAME", "")
    budget.check_available("user-a")
    assert budget.record_usage(100, 100, "claude-haiku-4-5", "user-a") == 0.0


def test_fails_open_when_the_table_cannot_be_read(monkeypatch):
    from botocore.exceptions import ClientError

    def boom(subject=None):
        raise ClientError({"Error": {"Code": "AccessDenied"}}, "GetItem")

    monkeypatch.setattr(budget, "spend", boom)
    # An unreachable meter must not take capture down; only a real over-spend blocks.
    budget.check_available("user-a")
