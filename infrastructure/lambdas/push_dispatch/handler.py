"""Sends the morning and evening digests, or sends nothing at all.

One invocation per send window, from an EventBridge Scheduler schedule carrying
`{"slot": "morning"}` or `{"slot": "evening"}`. Per invocation: list the identity
prefixes, and for each one read its subscriptions and its digest, re-derive the app's
own groups against today, and send only if this window has something to say.

The execution role can read `users/*/digest.json` and `users/*/push/*` and cannot name
`users/*/state.json` at all, so the privacy decision is enforced by IAM rather than by
this file being careful. Nothing here logs an endpoint, a URL or a task, because there
is no task in anything it reads.

Decision logic lives in `digest.py` and is where the tests are: everything in this file
is transport.
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Iterator
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

import boto3
from botocore.exceptions import ClientError
from py_vapid import Vapid
from pywebpush import WebPushException, webpush

from digest import SLOTS, Counts, Unusable, counts_for, for_device, notification

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ENVIRONMENT = os.environ.get("ENV", "dev")
REGION = os.environ.get("AWS_REGION", "eu-west-2")
SECRET_PREFIX = os.environ.get("SECRET_PREFIX", "/lifeboard")
BUCKET = os.environ.get("USER_DATA_BUCKET", "")
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "")

# The schedule fires in Europe/London, so the day the counts are read against has to be
# the local calendar day too. In BST a UTC date is the wrong day for the first hour of it.
ZONE = ZoneInfo("Europe/London")

# A digest is worthless once its window has passed. Four hours means a phone that was off
# at 07:30 still gets the morning line if it wakes by lunch, and never gets it at 20:00.
TTL_SECONDS = 4 * 60 * 60

PREFIX = "users/"

_s3: Any = None
_vapid: Vapid | None = None


def s3() -> Any:
    global _s3
    if _s3 is None:
        _s3 = boto3.client("s3", region_name=REGION)
    return _s3


def vapid_key() -> Vapid:
    """Read from SSM once per cold start. Never logged and never returned to anyone.

    Both forms py-vapid can emit are accepted, since which one lands in the parameter
    depends on how the pair was generated: the PEM `vapid --gen` writes, or a bare
    base64url key.
    """
    global _vapid
    if _vapid is None:
        name = f"{SECRET_PREFIX}/{ENVIRONMENT}/vapid-private-key"
        client = boto3.client("ssm", region_name=REGION)
        response = client.get_parameter(Name=name, WithDecryption=True)
        value = response["Parameter"]["Value"].strip()
        if "-----BEGIN" in value:
            _vapid = Vapid.from_pem(value.encode())
        else:
            _vapid = Vapid.from_string(value)
    return _vapid


def _pages(**kwargs: Any) -> Iterator[dict[str, Any]]:
    token: str | None = None
    while True:
        page = s3().list_objects_v2(**kwargs, **({"ContinuationToken": token} if token else {}))
        yield page
        token = page.get("NextContinuationToken")
        if not token:
            return


def identities() -> list[str]:
    """The identity prefixes under `users/`.

    Delimited, so the response carries common prefixes and never object keys. The role's
    list permission is conditioned on that delimiter for the same reason: enumerating
    identities is all this needs, and enumerating everything each identity owns is not.
    """
    found: list[str] = []
    for page in _pages(Bucket=BUCKET, Prefix=PREFIX, Delimiter="/"):
        for entry in page.get("CommonPrefixes", []):
            name = entry.get("Prefix", "")[len(PREFIX) :].strip("/")
            if name:
                found.append(name)
    return found


def _read_json(key: str) -> Any | None:
    """None when the object is absent or unparseable, which are both normal."""
    try:
        body = s3().get_object(Bucket=BUCKET, Key=key)["Body"].read()
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code")
        if code in ("NoSuchKey", "NoSuchBucket", "404"):
            return None
        raise
    try:
        return json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        logger.warning("push_unreadable_object key_suffix=%s", key.rsplit("/", 1)[-1])
        return None


def subscriptions(identity: str) -> list[dict[str, Any]]:
    """Every live subscription for one identity, as pywebpush wants it.

    A record with `enabled` false is how the client soft-deletes: the authenticated role
    has no `s3:DeleteObject`, so turning notifications off can only ever be a write. A
    record missing the flag is treated the same way, since the contract always writes it
    and guessing "on" would push to someone who asked us not to.
    """
    live: list[dict[str, Any]] = []
    for page in _pages(Bucket=BUCKET, Prefix=f"{PREFIX}{identity}/push/"):
        for entry in page.get("Contents", []):
            key = entry.get("Key", "")
            if not key.endswith(".json"):
                continue
            record = _read_json(key)
            if not isinstance(record, dict):
                continue
            if record.get("enabled") is not True:
                logger.info("push_subscription_skipped reason=not-enabled")
                continue
            endpoint = record.get("endpoint")
            keys = record.get("keys")
            if not isinstance(endpoint, str) or not isinstance(keys, dict):
                logger.warning("push_subscription_malformed reason=shape")
                continue
            p256dh, auth = keys.get("p256dh"), keys.get("auth")
            if not isinstance(p256dh, str) or not isinstance(auth, str):
                logger.warning("push_subscription_malformed reason=keys")
                continue
            live.append(
                {
                    "key": key,
                    "info": {"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}},
                    "max_actions": record.get("maxActions"),
                }
            )
    return live


def forget(key: str) -> None:
    """404 and 410 are permanent, so the record goes.

    The role can delete under `users/*/push/*` and can write nothing anywhere, which is
    the property worth keeping: it cannot touch `state.json` or `digest.json`. A failed
    delete is not fatal - the next window gets the same code and tries again.
    """
    try:
        s3().delete_object(Bucket=BUCKET, Key=key)
    except ClientError as exc:
        logger.warning(
            "push_forget_failed code=%s", exc.response.get("Error", {}).get("Code")
        )


def send(info: dict[str, Any], payload: str) -> str:
    """One push. Returns sent, gone, throttled or failed.

    The exception is never logged whole: it carries the endpoint, which is a device-scoped
    token and the one string in this system worth keeping out of CloudWatch.
    """
    try:
        webpush(
            subscription_info=info,
            data=payload,
            vapid_private_key=vapid_key(),
            vapid_claims={"sub": VAPID_SUBJECT},
            ttl=TTL_SECONDS,
        )
    except WebPushException as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        if status in (404, 410):
            return "gone"
        if status == 429:
            # Transient, and the next window is twelve hours away, so a retry queue would
            # buy nothing but a second thing to operate.
            logger.warning("push_throttled status=429")
            return "throttled"
        logger.error("push_send_failed status=%s", status)
        return "failed"
    return "sent"


def _dispatch(identity: str, slot: str, on: date, tally: dict[str, Any]) -> None:
    subs = subscriptions(identity)
    if not subs:
        # No subscription means no reason to read the digest at all.
        return

    raw = _read_json(f"{PREFIX}{identity}/digest.json")
    if raw is None:
        logger.info("push_no_digest slot=%s", slot)
        tally["unusable"] += 1
        return

    try:
        counts: Counts = counts_for(raw, on)
    except Unusable as exc:
        logger.info("push_digest_unusable slot=%s reason=%s", slot, exc)
        tally["unusable"] += 1
        return

    note = notification(slot, counts)
    if note is None:
        # The clear-day branch, and the normal case. Not a warning and not an error.
        logger.info(
            "push_suppressed slot=%s missed=%s today=%s", slot, counts.missed, counts.starting_today
        )
        tally["quiet"] += 1
        return

    for record in subs:
        payload = json.dumps(for_device(note, record["max_actions"]))
        outcome = send(record["info"], payload)
        if outcome == "gone":
            forget(record["key"])
            tally["gone"] += 1
        elif outcome == "sent":
            tally["sent"] += 1
        else:
            tally["failed"] += 1


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:  # noqa: ARG001
    """Entry point. The slot comes from the schedule, not from anything user-supplied."""
    slot = (event or {}).get("slot")
    if slot not in SLOTS:
        # A schedule passing anything else is a deploy fault, so fail loudly rather than
        # quietly picking a window.
        raise ValueError(f"slot must be one of {SLOTS}, got {slot!r}")

    on = datetime.now(tz=ZONE).date()
    tally: dict[str, Any] = {
        "slot": slot,
        "day": on.isoformat(),
        "sent": 0,
        "quiet": 0,
        "unusable": 0,
        "gone": 0,
        "failed": 0,
    }

    for identity in identities():
        _dispatch(identity, slot, on, tally)

    logger.info(
        "push_dispatch slot=%s day=%s sent=%s quiet=%s unusable=%s gone=%s failed=%s",
        slot,
        tally["day"],
        tally["sent"],
        tally["quiet"],
        tally["unusable"],
        tally["gone"],
        tally["failed"],
    )
    return tally
