"""Tests for the pre-sign-up allowlist. No AWS: the SSM read is stubbed."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
from botocore.exceptions import ClientError

# Loaded by path under a unique name. Every Lambda deploys as a flat bundle whose entry
# point is `handler`, so a plain `import handler` would resolve to whichever one pytest
# imported first and silently test the wrong module.
_spec = importlib.util.spec_from_file_location(
    "presignup_allowlist_handler", Path(__file__).parent / "handler.py"
)
handler = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(handler)


@pytest.fixture(autouse=True)
def _clear_cache(monkeypatch):
    monkeypatch.setattr(handler, "_cached", None)
    monkeypatch.setattr(handler, "PARAMETER_NAME", "/lifeboard/test/signin-allowlist")


def _event(email: str, trigger: str = "PreSignUp_ExternalProvider") -> dict:
    return {
        "triggerSource": trigger,
        "request": {"userAttributes": {"email": email}},
        "response": {},
    }


def _with_list(monkeypatch, raw: str) -> None:
    monkeypatch.setattr(handler, "allowlist", lambda: handler._parse(raw))


def test_allows_a_listed_address(monkeypatch):
    _with_list(monkeypatch, "one@example.com")
    out = handler.lambda_handler(_event("one@example.com"), None)
    assert out["response"]["autoConfirmUser"] is True
    assert out["response"]["autoVerifyEmail"] is True


def test_is_case_and_whitespace_insensitive(monkeypatch):
    _with_list(monkeypatch, "  One@Example.com , two@example.com ")
    assert handler.lambda_handler(_event("ONE@EXAMPLE.COM"), None)


def test_refuses_an_unlisted_address(monkeypatch):
    _with_list(monkeypatch, "one@example.com")
    with pytest.raises(Exception, match="not allowed"):
        handler.lambda_handler(_event("someone.else@gmail.com"), None)


def test_refuses_when_the_list_is_empty(monkeypatch):
    _with_list(monkeypatch, "")
    with pytest.raises(Exception, match="not allowed"):
        handler.lambda_handler(_event("one@example.com"), None)


def test_refuses_a_missing_email(monkeypatch):
    _with_list(monkeypatch, "one@example.com")
    with pytest.raises(Exception, match="not allowed"):
        handler.lambda_handler(_event(""), None)


def test_does_not_auto_confirm_a_native_signup(monkeypatch):
    """Only a federated identity has been vouched for by the provider."""
    _with_list(monkeypatch, "one@example.com")
    out = handler.lambda_handler(_event("one@example.com", "PreSignUp_SignUp"), None)
    assert "autoConfirmUser" not in out["response"]


def test_fails_closed_when_the_list_cannot_be_read(monkeypatch):
    def boom():
        raise ClientError({"Error": {"Code": "AccessDenied"}}, "GetParameter")

    monkeypatch.setattr(handler, "allowlist", boom)
    with pytest.raises(Exception, match="temporarily unavailable"):
        handler.lambda_handler(_event("one@example.com"), None)


def test_the_refusal_never_logs_the_address(monkeypatch, caplog):
    _with_list(monkeypatch, "one@example.com")
    with caplog.at_level("WARNING"), pytest.raises(Exception):
        handler.lambda_handler(_event("private.person@gmail.com"), None)
    assert "private.person" not in caplog.text
