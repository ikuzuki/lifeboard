"""Cognito pre-sign-up trigger: only allowlisted email addresses may create an account.

`allow_self_signup = false` on the user pool blocks the native sign-up form, but it does
**not** restrict which Google accounts may federate. Without this, anyone with a Google
account could sign in to a deployed Lifeboard, which makes this a cost control as much as
an access control: every account that signs in can call the capture Lambda and spend
against the monthly Anthropic cap.

The list lives in SSM rather than in this file so that changing it is one CLI call and no
deploy:

    aws ssm put-parameter --name /lifeboard/dev/signin-allowlist \\
      --value "one@example.com,two@example.com" --overwrite

Federated sign-in fires `PreSignUp_ExternalProvider`, not `PreSignUp_SignUp`, so both are
handled. Raising any exception makes Cognito refuse the sign-up.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

PARAMETER_NAME = os.environ.get("ALLOWLIST_PARAMETER", "")
# A short cache so a burst of sign-in attempts is not a burst of SSM calls, but an edit to
# the list still takes effect within a minute rather than at the next cold start.
CACHE_SECONDS = 60

_ssm = None
_cached: tuple[float, frozenset[str]] | None = None


def _client():
    global _ssm
    if _ssm is None:
        _ssm = boto3.client("ssm")
    return _ssm


def _parse(raw: str) -> frozenset[str]:
    return frozenset(part.strip().lower() for part in raw.split(",") if part.strip())


def allowlist() -> frozenset[str]:
    """The current list, cached briefly. An empty list denies everyone."""
    global _cached
    now = time.monotonic()
    if _cached and now - _cached[0] < CACHE_SECONDS:
        return _cached[1]
    raw = _client().get_parameter(Name=PARAMETER_NAME)["Parameter"]["Value"]
    parsed = _parse(raw)
    _cached = (now, parsed)
    return parsed


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:  # noqa: ARG001
    email = (event.get("request", {}).get("userAttributes", {}).get("email") or "").strip().lower()
    trigger = event.get("triggerSource", "")

    try:
        allowed = allowlist()
    except ClientError:
        # Deny on an unreadable list. This is the one place failing open would hand out
        # accounts, so it fails closed even though that means a broken parameter locks
        # everyone out until it is fixed.
        logger.exception("allowlist_unreadable parameter=%s", PARAMETER_NAME)
        raise Exception("Sign-up is temporarily unavailable.") from None

    if email and email in allowed:
        logger.info("signup_allowed trigger=%s", trigger)
        # Federated identities arrive already verified by Google, so confirming here
        # avoids a pointless verification email to an address Google just vouched for.
        if trigger == "PreSignUp_ExternalProvider":
            event["response"]["autoConfirmUser"] = True
            event["response"]["autoVerifyEmail"] = True
        return event

    # Never log the address that was refused: it is somebody's personal data and this
    # log group is not the place for it.
    logger.warning("signup_refused trigger=%s allowlist_size=%s", trigger, len(allowed))
    raise Exception("This address is not allowed to sign in.")
