"""DynamoDB-backed monthly spend caps for the capture Lambda.

Ported from fpl-platform's `services/agent/src/fpl_agent/middleware/budget.py`, with the
same policy: **check up front, never reconcile after the fact.** If a cap is already
reached the model is never called, so the bill cannot run away between the check and the
invoice.

This exists because the Anthropic bill is the only usage-scaling cost in Lifeboard, and the
AWS Budgets in `infrastructure/bootstrap` can only see AWS spend. Without this the one
thing that can grow is the one thing nothing is watching.

**Two caps, both enforced.** The global cap bounds the bill whatever happens. The per-user
cap stops one account spending everyone else's allowance, which a single global cap cannot
do — with a global cap alone, the first person to run a loop takes the lot.

Both live in the same table under different partition values, so one conditional-write path
serves both and there is no second table to keep in step:

- ``2026-08``                  the global row for that month
- ``2026-08#<cognito sub>``    one row per user per month

Columns on every row: ``total_input_tokens``, ``total_output_tokens``, ``total_cost_usd``
(the figure the caps compare against), ``budget_limit_usd`` as a cheap audit trail,
``exceeded_at`` stamped once when a cap is first crossed, and ``updated_at``.

Rows lazy-create on first touch, so a new month never needs a deploy.
"""

from __future__ import annotations

import logging
import os
from datetime import UTC, datetime

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger()

# USD per million tokens, Anthropic public pricing. This is the single place the
# tokens-to-dollars sum happens; update it when the rates change.
_MODEL_RATES: dict[str, tuple[float, float]] = {
    "claude-haiku-4-5": (1.0, 5.0),
    "claude-sonnet-5": (3.0, 15.0),
    "claude-opus-5": (5.0, 25.0),
}
# An unknown model is priced as Opus, so an unrecognised id overestimates rather than
# slipping under a cap.
_FALLBACK_RATE = (5.0, 25.0)

TABLE_NAME = os.environ.get("USAGE_TABLE", "")
GLOBAL_LIMIT_USD = float(os.environ.get("MONTHLY_LIMIT_USD", "5"))
USER_LIMIT_USD = float(os.environ.get("USER_MONTHLY_LIMIT_USD", "2"))

_client = None


class BudgetExceeded(Exception):
    """A cap for this month has already been reached. Maps to 429."""


def _table():
    global _client
    if _client is None:
        _client = boto3.client("dynamodb")
    return _client


def current_month() -> str:
    return datetime.now(UTC).strftime("%Y-%m")


def row_key(subject: str | None = None) -> str:
    """The partition this spend counts against: the month, or the month and one user."""
    month = current_month()
    return f"{month}#{subject}" if subject else month


def cost_usd(input_tokens: int, output_tokens: int, model: str) -> float:
    rate_in, rate_out = _MODEL_RATES.get(model, _FALLBACK_RATE)
    return (input_tokens * rate_in + output_tokens * rate_out) / 1_000_000


def _ensure_row(key: str, limit: float) -> None:
    """Create the row if it is absent. A clash is the common case, not an error."""
    try:
        _table().put_item(
            TableName=TABLE_NAME,
            Item={
                "month": {"S": key},
                "total_input_tokens": {"N": "0"},
                "total_output_tokens": {"N": "0"},
                "total_cost_usd": {"N": "0"},
                "budget_limit_usd": {"N": str(limit)},
                "updated_at": {"S": datetime.now(UTC).isoformat()},
            },
            ConditionExpression="attribute_not_exists(#m)",
            ExpressionAttributeNames={"#m": "month"},
        )
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return
        raise


def spend(subject: str | None = None) -> float:
    """This month's spend: globally when `subject` is None, otherwise for that user."""
    resp = _table().get_item(
        TableName=TABLE_NAME,
        Key={"month": {"S": row_key(subject)}},
        ConsistentRead=True,
    )
    item = resp.get("Item")
    return float(item["total_cost_usd"]["N"]) if item else 0.0


def check_available(subject: str | None = None) -> None:
    """Raise `BudgetExceeded` when either cap for this month has been reached.

    Fails **open** on an infrastructure error: an unreachable table should not take capture
    down, and these caps guard against drift rather than attack. It fails closed on an
    actual over-spend, which is the case that matters.
    """
    if not TABLE_NAME:
        return
    try:
        total = spend()
        mine = spend(subject) if subject else 0.0
    except ClientError:
        logger.exception("budget_check_failed month=%s", current_month())
        return

    if total >= GLOBAL_LIMIT_USD:
        logger.warning(
            "budget_exceeded scope=global month=%s spent=%.4f limit=%.2f",
            current_month(),
            total,
            GLOBAL_LIMIT_USD,
        )
        raise BudgetExceeded(f"the monthly cap of ${GLOBAL_LIMIT_USD:.2f} is reached")

    if subject and mine >= USER_LIMIT_USD:
        # The identity is deliberately absent from the log line: it is personal data and
        # this log group is not the place for it. The row key carries it if ever needed.
        logger.warning(
            "budget_exceeded scope=user month=%s spent=%.4f limit=%.2f",
            current_month(),
            mine,
            USER_LIMIT_USD,
        )
        raise BudgetExceeded(f"your monthly cap of ${USER_LIMIT_USD:.2f} is reached")


def record_usage(
    input_tokens: int, output_tokens: int, model: str, subject: str | None = None
) -> float:
    """Add one call to both totals. Returns the new global running cost."""
    if not TABLE_NAME:
        return 0.0
    delta = cost_usd(input_tokens, output_tokens, model)
    total = _add(row_key(), GLOBAL_LIMIT_USD, input_tokens, output_tokens, delta)
    if subject:
        _add(row_key(subject), USER_LIMIT_USD, input_tokens, output_tokens, delta)
    return total


def _add(key: str, limit: float, input_tokens: int, output_tokens: int, delta: float) -> float:
    """One atomic ADD against one row. Returns that row's new running cost."""
    try:
        _ensure_row(key, limit)
        resp = _table().update_item(
            TableName=TABLE_NAME,
            Key={"month": {"S": key}},
            UpdateExpression=(
                "ADD total_input_tokens :it, total_output_tokens :ot, total_cost_usd :c "
                "SET updated_at = :ts"
            ),
            ExpressionAttributeValues={
                ":it": {"N": str(input_tokens)},
                ":ot": {"N": str(output_tokens)},
                ":c": {"N": str(delta)},
                ":ts": {"S": datetime.now(UTC).isoformat()},
            },
            ReturnValues="UPDATED_NEW",
        )
        running = float(resp["Attributes"]["total_cost_usd"]["N"])
    except ClientError:
        # Never fail a capture the user has already paid for because the meter would not
        # write. An over-spend blocks; a broken meter does not.
        logger.exception("budget_record_failed key=%s", key)
        return 0.0

    if running >= limit:
        _stamp_exceeded(key)
    return running


def _stamp_exceeded(key: str) -> None:
    """Record when a cap was first crossed. Idempotent."""
    try:
        _table().update_item(
            TableName=TABLE_NAME,
            Key={"month": {"S": key}},
            UpdateExpression="SET exceeded_at = :ts",
            ConditionExpression="attribute_not_exists(exceeded_at)",
            ExpressionAttributeValues={":ts": {"S": datetime.now(UTC).isoformat()}},
        )
        logger.warning("budget_cap_crossed key=%s", key)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return
        raise
