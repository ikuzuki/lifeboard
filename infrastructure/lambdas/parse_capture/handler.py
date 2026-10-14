"""Turns a brain dump into draft items with one Claude Haiku call.

The key lives in SSM Parameter Store as a SecureString, is read once per cold start
into the environment, and is never logged or returned. The browser never sees it.

The response is a validated array of items, not prose: structured outputs pin the
shape server side, and this module re-validates on the way out so a schema drift
surfaces here rather than as a wrong date in someone's list.
"""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import date
from typing import Any

import anthropic
import boto3

from budget import BudgetExceeded, check_available, record_usage

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ENVIRONMENT = os.environ.get("ENV", "dev")
REGION = os.environ.get("AWS_REGION", "eu-west-2")
SECRET_PREFIX = os.environ.get("SECRET_PREFIX", "/lifeboard")
MODEL = os.environ.get("MODEL", "claude-haiku-4-5")

# 300 output tokens is the expected size; the ceiling exists so a long dump cannot
# truncate the JSON mid-item, which would surface as an unhelpful validation error.
MAX_TOKENS = 2048
MAX_TEXT = 4000
MAX_INDEX = 80
MAX_ITEMS = 25

DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Static, and therefore the cacheable half of the prompt. Everything that changes per
# call, including today's date, lives in the user block so this stays byte-identical.
SYSTEM = """You turn a spoken or typed brain dump into draft items for one person's tracker.

Return one item per distinct thing they mentioned. A single sentence can hold several \
things and two sentences can describe one, so split on intent rather than punctuation.

Titles are short and lead with the verb where one fits: "book the dentist", not "I need \
to book the dentist at some point".

Dates are the part worth being careful about. Fill act, the day to start, and due, a \
real external deadline, only where the dump states or plainly implies them. "Next \
Tuesday" is implied. "Before the insurance renews" is implied when the existing items \
give you the renewal date. "Soon", "at some point" and "when I get round to it" are not \
dates. Leave a field null rather than guess: an empty field they fill in themselves is \
far better than a confident wrong one, and that applies to every field, not just dates.

Where only a deadline was given, leave act null. Never set act later than due.

Weekday names follow one rule. Weeks run Monday to Sunday. A bare weekday, or one with "this", means the one in the current week: said on a Wednesday, "Friday" and "this Friday" both mean two days later, and if that weekday has already gone this week it means the next one to come. "Next" plus a weekday means the one in the following week: said on a Wednesday, "next Tuesday" is six days later, not thirteen. The exception is when that would land within two days, which is not what anyone means by "next": said on a Sunday, "next Monday" is the Monday eight days later, not tomorrow.

Work it out by finding the Monday that starts the following week, then counting forward to the weekday named. Said on Wednesday 19 August 2026, the following week starts Monday 24 August, so "next Monday" is 24 August, "next Tuesday" is 25 August, and "next Sunday" is 30 August. Do not add a further week on top of that.

Set buy true only for something being purchased, and cost only where an amount was \
actually said. Use description only where the dump carries detail worth keeping; never \
restate the title in it.

Choose category from the list supplied with the dump and from nothing else.

Ignore whatever is not a thing to do: greetings, thinking out loud, and anything they \
correct or retract while speaking."""

ITEM_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["title", "category", "description", "act", "due", "buy", "cost"],
    "properties": {
        "title": {"type": "string", "description": "Short imperative title."},
        "category": {"type": "string", "description": "One of the supplied categories."},
        "description": {"type": "string", "description": "Detail worth keeping, else empty."},
        "act": {
            "anyOf": [{"type": "string"}, {"type": "null"}],
            "description": "Day to start, YYYY-MM-DD, or null when not stated or implied.",
        },
        "due": {
            "anyOf": [{"type": "string"}, {"type": "null"}],
            "description": "External deadline, YYYY-MM-DD, or null when not stated or implied.",
        },
        "buy": {"type": "boolean", "description": "True only for a purchase."},
        "cost": {
            "anyOf": [{"type": "number"}, {"type": "null"}],
            "description": "Amount in pounds, or null when no amount was said.",
        },
    },
}

RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["items"],
    "properties": {"items": {"type": "array", "items": ITEM_SCHEMA}},
}

_client: anthropic.Anthropic | None = None


class BadRequest(Exception):
    """The payload could not be used. Maps to 400."""


class ModelFailure(Exception):
    """The model call failed or returned something unusable. Maps to 502."""


def _resolve_key() -> None:
    """Read the API key from SSM into the environment.

    Idempotent, and the environment is the cache: a warm invocation returns without
    contacting AWS. Never logs the value, and the value is deliberately not a Lambda
    environment variable, so it stays out of Terraform state and out of
    GetFunctionConfiguration output.
    """
    if os.environ.get("ANTHROPIC_API_KEY"):
        return
    name = f"{SECRET_PREFIX}/{ENVIRONMENT}/anthropic-api-key"
    client = boto3.client("ssm", region_name=REGION)
    response = client.get_parameter(Name=name, WithDecryption=True)
    os.environ["ANTHROPIC_API_KEY"] = response["Parameter"]["Value"]


def client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _resolve_key()
        _client = anthropic.Anthropic()
    return _client


def _text(value: Any, field: str, limit: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise BadRequest(f"{field} must be a non-empty string")
    return value.strip()[:limit]


def _index_block(existing: Any) -> str:
    """Titles and dates only. Descriptions and notes never leave the device."""
    if not isinstance(existing, list):
        return "(none)"
    lines = []
    for entry in existing[:MAX_INDEX]:
        if not isinstance(entry, dict):
            continue
        title = entry.get("title")
        if not isinstance(title, str) or not title.strip():
            continue
        act = entry.get("act") if isinstance(entry.get("act"), str) else "-"
        due = entry.get("due") if isinstance(entry.get("due"), str) else "-"
        lines.append(f"- {title.strip()[:120]} | {act} | {due}")
    return "\n".join(lines) or "(none)"


def build_prompt(payload: dict[str, Any]) -> str:
    """The volatile half: today, the category list, the index, and the dump."""
    text = _text(payload.get("text"), "text", MAX_TEXT)
    today = payload.get("today")
    if not isinstance(today, str) or not DAY.match(today):
        raise BadRequest("today must be YYYY-MM-DD")
    categories = payload.get("categories")
    if not isinstance(categories, list) or not all(isinstance(c, str) for c in categories):
        raise BadRequest("categories must be a list of strings")

    weekday = date.fromisoformat(today).strftime("%A")
    return (
        f"Today is {today}, a {weekday}.\n"
        f"Categories: {', '.join(categories)}\n"
        "Existing items, as title | start-by | deadline, for resolving relative "
        "references only:\n"
        f"{_index_block(payload.get('existing'))}\n\n"
        "Dump:\n"
        f'"""\n{text}\n"""'
    )


def _day(value: Any) -> str | None:
    return value if isinstance(value, str) and DAY.match(value) else None


def _clean(raw: Any, categories: list[str]) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    title = raw.get("title")
    if not isinstance(title, str) or not title.strip():
        return None
    category = raw.get("category")
    cost = raw.get("cost")
    return {
        "title": title.strip()[:200],
        "category": category if category in categories else (categories[0] if categories else ""),
        "description": raw["description"].strip() if isinstance(raw.get("description"), str) else "",
        "act": _day(raw.get("act")),
        "due": _day(raw.get("due")),
        "buy": raw.get("buy") is True,
        "cost": float(cost) if isinstance(cost, (int, float)) and not isinstance(cost, bool) else None,
    }


def extract_items(response: Any, categories: list[str]) -> list[dict[str, Any]]:
    """Read the structured output and re-validate it.

    Structured outputs guarantee the first text block is JSON matching the schema, but
    an empty title or a category outside the supplied list would still be schema-valid
    and useless, so the shape is checked again here.
    """
    stop = getattr(response, "stop_reason", None)
    if stop == "refusal":
        raise ModelFailure("model refused the dump")
    body = next((b.text for b in getattr(response, "content", []) if getattr(b, "type", None) == "text"), None)
    if not body:
        raise ModelFailure(f"no text block in response, stop_reason={stop}")
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError as exc:
        raise ModelFailure(f"response was not JSON: {exc}") from exc
    items = parsed.get("items") if isinstance(parsed, dict) else None
    if not isinstance(items, list):
        raise ModelFailure("response had no items array")
    cleaned = [c for c in (_clean(raw, categories) for raw in items[:MAX_ITEMS]) if c]
    if not cleaned:
        raise ModelFailure("no usable items in response")
    return cleaned


def _log_usage(response: Any) -> None:
    """Machine-greppable and free of content. Never log the dump itself."""
    usage = getattr(response, "usage", None)
    logger.info(
        "capture_usage model=%s stop_reason=%s input_tokens=%s output_tokens=%s "
        "cache_write_tokens=%s cache_read_tokens=%s",
        MODEL,
        getattr(response, "stop_reason", None),
        getattr(usage, "input_tokens", 0),
        getattr(usage, "output_tokens", 0),
        getattr(usage, "cache_creation_input_tokens", 0),
        getattr(usage, "cache_read_input_tokens", 0),
    )


def parse_dump(payload: dict[str, Any], subject: str | None = None) -> list[dict[str, Any]]:
    # Up front, so an over-budget month never reaches the model at all.
    check_available(subject)
    prompt = build_prompt(payload)
    categories = [c for c in payload["categories"] if isinstance(c, str)]

    # cache_control on the static block. Note the minimum cacheable prefix on Haiku 4.5
    # is 4096 tokens and this system block is far shorter, so nothing is cached today
    # and cache_write_tokens will read zero. It costs nothing to declare and starts
    # working if the prompt grows or the model changes.
    response = client().messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
        output_config={"format": {"type": "json_schema", "schema": RESPONSE_SCHEMA}},
        messages=[{"role": "user", "content": prompt}],
    )
    _log_usage(response)
    usage = getattr(response, "usage", None)
    record_usage(
        getattr(usage, "input_tokens", 0) or 0,
        getattr(usage, "output_tokens", 0) or 0,
        MODEL,
        subject,
    )
    return extract_items(response, categories)


def _reply(status: int, body: dict[str, Any]) -> dict[str, Any]:
    # CORS is set on the API, not here, so there is one place it can drift from.
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:  # noqa: ARG001
    """HTTP API entry point. The JWT authorizer has already rejected anonymous calls."""
    claims = (
        event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
    )
    subject = claims.get("sub", "unknown")

    try:
        payload = json.loads(event.get("body") or "{}")
        if not isinstance(payload, dict):
            raise BadRequest("body must be a JSON object")
    except (json.JSONDecodeError, BadRequest) as exc:
        logger.warning("capture_rejected sub=%s reason=%s", subject, exc)
        return _reply(400, {"error": "bad request"})

    try:
        items = parse_dump(payload, subject)
    except BadRequest as exc:
        logger.warning("capture_rejected sub=%s reason=%s", subject, exc)
        return _reply(400, {"error": "bad request"})
    except BudgetExceeded as exc:
        logger.warning("capture_over_budget sub=%s reason=%s", subject, exc)
        return _reply(429, {"error": "monthly parsing budget reached"})
    except ModelFailure as exc:
        # 502 rather than 500: the request was fine and the upstream model was not, which
        # is the case the client degrades to putting the raw text in a title.
        logger.error("capture_model_failure sub=%s reason=%s", subject, exc)
        return _reply(502, {"error": "parsing unavailable"})
    except Exception:  # noqa: BLE001 - SDK and boto3 exceptions vary; never leak them
        logger.exception("capture_failed sub=%s", subject)
        return _reply(502, {"error": "parsing unavailable"})

    logger.info("capture_parsed sub=%s items=%s", subject, len(items))
    return _reply(200, {"items": items})
