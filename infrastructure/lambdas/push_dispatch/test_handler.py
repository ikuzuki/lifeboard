"""The dispatch loop: which records are read, which are sent to, and which are forgotten.

No AWS and no push service. S3 is a dictionary and `webpush` is a recorder, so the
assertions are about what came out of a send window rather than about a mock having been
touched. `pywebpush` is stubbed before the import, so this runs with nothing installed
beyond boto3, which the runtime ships anyway.

Loaded under an explicit module name rather than with `import handler`: two Lambdas both
have a `handler.py`, and whichever suite runs first would otherwise own the name.
"""

from __future__ import annotations

import importlib.util
import json
import logging
import sys
import types
from pathlib import Path

import pytest
from botocore.exceptions import ClientError

logging.disable(logging.CRITICAL)

HERE = Path(__file__).parent

if "py_vapid" not in sys.modules:
    # Only the type of the cold-start cache; the tests hand `send` a key of their own.
    _vapid_stub = types.ModuleType("py_vapid")
    _vapid_stub.Vapid = type("Vapid", (), {})  # type: ignore[attr-defined]
    sys.modules["py_vapid"] = _vapid_stub

if "pywebpush" not in sys.modules:
    _stub = types.ModuleType("pywebpush")

    class WebPushException(Exception):  # noqa: N818 - the library's own name
        def __init__(self, message: str = "", response: object = None) -> None:
            super().__init__(message)
            self.response = response

    _stub.WebPushException = WebPushException  # type: ignore[attr-defined]
    _stub.webpush = lambda **_: None  # type: ignore[attr-defined]
    sys.modules["pywebpush"] = _stub

# digest.py is imported by handler.py as a top-level module, the way the flat deployment
# bundle lays it out.
sys.path.insert(0, str(HERE))

_spec = importlib.util.spec_from_file_location("push_dispatch_handler", HERE / "handler.py")
handler = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = handler
_spec.loader.exec_module(handler)

WebPushException = sys.modules["pywebpush"].WebPushException

DIGEST = {
    "version": 1,
    "computedFor": "2026-08-19",
    "overdue": {"all": 4, "weekdayOnly": 0},
    "byDay": {"2026-08-19": {"all": 2, "weekdayOnly": 0}},
    "chronic": 0,
}

SUBSCRIPTION = {
    "endpoint": "https://fcm.googleapis.com/fcm/send/abc123",
    "expirationTime": None,
    "keys": {"p256dh": "BNc-public-point", "auth": "k9x-auth-secret"},
    "enabled": True,
}


class FakeS3:
    """Enough of the S3 API to run a send window, and a record of what was deleted."""

    def __init__(self, objects: dict[str, object]) -> None:
        self.objects = {key: json.dumps(value).encode() for key, value in objects.items()}
        self.deleted: list[str] = []
        self.denied_deletes = False

    # Capitalised parameters because boto3's are.
    def list_objects_v2(  # noqa: N803
        self, Bucket: str, Prefix: str, Delimiter: str = "", **_: object
    ) -> dict:
        keys = [key for key in self.objects if key.startswith(Prefix)]
        if not Delimiter:
            return {"Contents": [{"Key": key} for key in sorted(keys)]}
        prefixes = {
            Prefix + key[len(Prefix) :].split(Delimiter)[0] + Delimiter
            for key in keys
            if Delimiter in key[len(Prefix) :]
        }
        return {"CommonPrefixes": [{"Prefix": p} for p in sorted(prefixes)]}

    def get_object(self, Bucket: str, Key: str) -> dict:  # noqa: N803
        if Key not in self.objects:
            raise ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")
        return {"Body": _Body(self.objects[Key])}

    def delete_object(self, Bucket: str, Key: str) -> dict:  # noqa: N803
        if self.denied_deletes:
            raise ClientError({"Error": {"Code": "AccessDenied"}}, "DeleteObject")
        self.deleted.append(Key)
        self.objects.pop(Key, None)
        return {}


class _Body:
    def __init__(self, raw: bytes) -> None:
        self.raw = raw

    def read(self) -> bytes:
        return self.raw


class Recorder:
    """Stands in for `webpush`, optionally answering with a push service's refusal."""

    def __init__(self, status: int | None = None) -> None:
        self.status = status
        self.calls: list[dict] = []

    def __call__(self, **kwargs: object) -> None:
        self.calls.append(kwargs)
        if self.status is not None:
            response = types.SimpleNamespace(status_code=self.status)
            raise WebPushException("refused", response=response)


class FixedClock:
    """The send day, so a run in November asserts the same thing as one in August."""

    @staticmethod
    def now(tz: object = None) -> object:  # noqa: ARG004
        import datetime

        return datetime.datetime(2026, 8, 19, 7, 30)


@pytest.fixture
def dispatch(monkeypatch):
    """Wires a fake bucket and a recorder in, then runs one send window against them."""

    def run(objects: dict[str, object], slot: str = "morning", status: int | None = None):
        store = FakeS3(objects)
        recorder = Recorder(status)
        monkeypatch.setattr(handler, "_s3", store)
        monkeypatch.setattr(handler, "webpush", recorder)
        monkeypatch.setattr(handler, "vapid_key", lambda: "a-vapid-key")
        monkeypatch.setattr(handler, "VAPID_SUBJECT", "https://lifeboard.example")
        monkeypatch.setattr(handler, "datetime", FixedClock)
        return handler.lambda_handler({"slot": slot}, None), store, recorder

    return run


def test_sends_one_push_per_live_subscription(dispatch):
    tally, _, recorder = dispatch(
        {
            "users/eu-west-2:abc/digest.json": DIGEST,
            "users/eu-west-2:abc/push/one.json": SUBSCRIPTION,
            "users/eu-west-2:abc/push/two.json": {**SUBSCRIPTION, "endpoint": "https://b/2"},
        }
    )
    assert tally["sent"] == 2
    assert json.loads(recorder.calls[0]["data"])["title"] == "4 missed, 2 start today"


def test_a_disabled_record_is_a_soft_delete_and_is_skipped(dispatch):
    """The client has no s3:DeleteObject, so turning it off can only ever be a write."""
    tally, _, recorder = dispatch(
        {
            "users/eu-west-2:abc/digest.json": DIGEST,
            "users/eu-west-2:abc/push/one.json": {**SUBSCRIPTION, "enabled": False},
        }
    )
    assert (tally["sent"], recorder.calls) == (0, [])


def test_a_record_without_the_flag_is_treated_as_off(dispatch):
    record = {key: value for key, value in SUBSCRIPTION.items() if key != "enabled"}
    tally, _, _ = dispatch(
        {"users/eu-west-2:abc/digest.json": DIGEST, "users/eu-west-2:abc/push/one.json": record}
    )
    assert tally["sent"] == 0


def test_a_clear_day_sends_nothing_and_is_not_a_failure(dispatch):
    clear = {**DIGEST, "overdue": {"all": 0, "weekdayOnly": 0}, "byDay": {}}
    tally, _, recorder = dispatch(
        {
            "users/eu-west-2:abc/digest.json": clear,
            "users/eu-west-2:abc/push/one.json": SUBSCRIPTION,
        }
    )
    assert (tally["quiet"], tally["failed"], recorder.calls) == (1, 0, [])


def test_an_unusable_digest_stops_that_user_and_not_the_run(dispatch):
    tally, _, _ = dispatch(
        {
            "users/eu-west-2:abc/digest.json": {**DIGEST, "version": 99},
            "users/eu-west-2:abc/push/one.json": SUBSCRIPTION,
            "users/eu-west-2:zzz/digest.json": DIGEST,
            "users/eu-west-2:zzz/push/one.json": SUBSCRIPTION,
        }
    )
    assert (tally["unusable"], tally["sent"]) == (1, 1)


def test_a_user_with_no_digest_yet_is_left_alone(dispatch):
    tally, _, recorder = dispatch({"users/eu-west-2:abc/push/one.json": SUBSCRIPTION})
    assert (tally["unusable"], recorder.calls) == (1, [])


def test_no_subscription_means_the_digest_is_never_read(dispatch):
    tally, _, _ = dispatch({"users/eu-west-2:abc/digest.json": DIGEST})
    assert tally == {
        "slot": "morning",
        "day": "2026-08-19",
        "sent": 0,
        "quiet": 0,
        "unusable": 0,
        "gone": 0,
        "failed": 0,
    }


@pytest.mark.parametrize("status", [404, 410])
def test_a_dead_endpoint_is_forgotten(dispatch, status):
    tally, store, _ = dispatch(
        {
            "users/eu-west-2:abc/digest.json": DIGEST,
            "users/eu-west-2:abc/push/one.json": SUBSCRIPTION,
        },
        status=status,
    )
    assert store.deleted == ["users/eu-west-2:abc/push/one.json"]
    assert (tally["gone"], tally["sent"]) == (1, 0)


def test_a_throttled_send_keeps_the_subscription(dispatch):
    """429 is transient, and the next window is twelve hours away."""
    tally, store, _ = dispatch(
        {
            "users/eu-west-2:abc/digest.json": DIGEST,
            "users/eu-west-2:abc/push/one.json": SUBSCRIPTION,
        },
        status=429,
    )
    assert (store.deleted, tally["gone"], tally["failed"]) == ([], 0, 1)


def test_a_delete_the_role_cannot_do_does_not_take_the_window_down(monkeypatch):
    store = FakeS3(
        {
            "users/eu-west-2:abc/digest.json": DIGEST,
            "users/eu-west-2:abc/push/one.json": SUBSCRIPTION,
        }
    )
    store.denied_deletes = True
    monkeypatch.setattr(handler, "_s3", store)
    monkeypatch.setattr(handler, "webpush", Recorder(410))
    monkeypatch.setattr(handler, "vapid_key", lambda: "a-vapid-key")
    monkeypatch.setattr(handler, "datetime", FixedClock)
    assert handler.lambda_handler({"slot": "evening"}, None)["gone"] == 1


def test_the_evening_carries_the_button_and_the_morning_does_not(dispatch):
    objects = {
        "users/eu-west-2:abc/digest.json": DIGEST,
        "users/eu-west-2:abc/push/one.json": SUBSCRIPTION,
    }
    _, _, evening = dispatch(objects, slot="evening")
    _, _, morning = dispatch(objects, slot="morning")
    assert json.loads(evening.calls[0]["data"])["actions"][0]["action"] == "missed"
    assert "actions" not in json.loads(morning.calls[0]["data"])


def test_a_device_reporting_no_action_support_gets_no_button(dispatch):
    _, _, recorder = dispatch(
        {
            "users/eu-west-2:abc/digest.json": DIGEST,
            "users/eu-west-2:abc/push/one.json": {**SUBSCRIPTION, "maxActions": 0},
        },
        slot="evening",
    )
    assert "actions" not in json.loads(recorder.calls[0]["data"])


def test_the_push_carries_what_the_protocol_needs_and_nothing_else(dispatch):
    _, _, recorder = dispatch(
        {
            "users/eu-west-2:abc/digest.json": DIGEST,
            "users/eu-west-2:abc/push/one.json": SUBSCRIPTION,
        }
    )
    call = recorder.calls[0]
    assert set(call["subscription_info"]) == {"endpoint", "keys"}
    assert set(call["subscription_info"]["keys"]) == {"p256dh", "auth"}
    assert call["vapid_claims"] == {"sub": "https://lifeboard.example"}


def test_a_malformed_subscription_is_skipped_rather_than_ending_the_window(dispatch):
    tally, _, _ = dispatch(
        {
            "users/eu-west-2:abc/digest.json": DIGEST,
            "users/eu-west-2:abc/push/one.json": {"enabled": True, "endpoint": "https://a"},
            "users/eu-west-2:abc/push/two.json": SUBSCRIPTION,
        }
    )
    assert tally["sent"] == 1


def test_an_unknown_slot_fails_loudly(dispatch):
    with pytest.raises(ValueError, match="slot must be one of"):
        dispatch({}, slot="midday")
