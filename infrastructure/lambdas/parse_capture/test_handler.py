"""Server-side contract for the capture parser.

Standard library only, and the model is never called: `anthropic` and `boto3` are
stubbed before the handler is imported, so this runs with nothing installed.

    python -m unittest discover -s infrastructure/lambdas/parse_capture

Not wired into `npx vitest run`, which is the repo's test command; it has no Python
runner. Run it by hand, or add it to CI alongside the Node suite.
"""

from __future__ import annotations

import json
import logging
import sys
import types
import unittest
from unittest.mock import MagicMock

# The handler logs a stack trace on the failure paths, which is correct and makes the
# test output unreadable. Assertions cover the response, not the log line.
logging.disable(logging.CRITICAL)

# Stand-ins for the two imports the handler makes at module scope. Registering them
# before the import keeps the test independent of the deployment package.
for name in ("anthropic", "boto3"):
    if name not in sys.modules:
        module = types.ModuleType(name)
        module.Anthropic = MagicMock()  # type: ignore[attr-defined]
        module.client = MagicMock()  # type: ignore[attr-defined]
        sys.modules[name] = module

sys.path.insert(0, __file__.rsplit("/", 1)[0].rsplit("\\", 1)[0])

import handler  # noqa: E402

CATEGORIES = ["health", "exercise", "career", "admin", "events", "home", "learning"]


def response(items: object, stop_reason: str = "end_turn") -> MagicMock:
    """A fake Anthropic response holding one text block, as structured outputs give."""
    block = MagicMock()
    block.type = "text"
    block.text = items if isinstance(items, str) else json.dumps({"items": items})

    reply = MagicMock()
    reply.content = [block]
    reply.stop_reason = stop_reason
    reply.usage = MagicMock(input_tokens=1400, output_tokens=280)
    return reply


class BuildPrompt(unittest.TestCase):
    def payload(self, **overrides: object) -> dict[str, object]:
        base: dict[str, object] = {
            "text": "book the dentist and buy a shoehorn",
            "today": "2026-08-17",
            "categories": CATEGORIES,
            "existing": [],
        }
        base.update(overrides)
        return base

    def test_carries_today_the_weekday_and_the_categories(self) -> None:
        prompt = handler.build_prompt(self.payload())
        self.assertIn("Today is 2026-08-17, a Monday.", prompt)
        self.assertIn("health, exercise", prompt)
        self.assertIn("book the dentist", prompt)

    def test_index_is_titles_and_dates_only(self) -> None:
        prompt = handler.build_prompt(
            self.payload(
                existing=[
                    {
                        "title": "renew the insurance",
                        "act": "2026-09-01",
                        "due": "2026-09-14",
                        "description": "policy 12345",
                        "notes": ["private"],
                    }
                ]
            )
        )
        self.assertIn("- renew the insurance | 2026-09-01 | 2026-09-14", prompt)
        self.assertNotIn("12345", prompt)
        self.assertNotIn("private", prompt)

    def test_missing_dates_render_as_a_dash_rather_than_a_guess(self) -> None:
        prompt = handler.build_prompt(
            self.payload(existing=[{"title": "learn to swim", "act": None, "due": None}])
        )
        self.assertIn("- learn to swim | - | -", prompt)

    def test_rejects_a_payload_it_cannot_use(self) -> None:
        for bad in ({"text": ""}, self.payload(today="tomorrow"), self.payload(categories="admin")):
            with self.subTest(bad=bad), self.assertRaises(handler.BadRequest):
                handler.build_prompt(bad)  # type: ignore[arg-type]

    def test_caps_the_transcript_and_the_index(self) -> None:
        prompt = handler.build_prompt(
            self.payload(
                text="x" * 9000,
                existing=[{"title": f"item {n}"} for n in range(200)],
            )
        )
        self.assertIn("x" * handler.MAX_TEXT, prompt)
        self.assertNotIn("x" * (handler.MAX_TEXT + 1), prompt)
        self.assertEqual(prompt.count("- item "), handler.MAX_INDEX)


class ExtractItems(unittest.TestCase):
    def test_returns_validated_items(self) -> None:
        items = handler.extract_items(
            response(
                [
                    {
                        "title": "book the dentist",
                        "category": "health",
                        "description": "",
                        "act": "2026-08-20",
                        "due": None,
                        "buy": False,
                        "cost": None,
                    }
                ]
            ),
            CATEGORIES,
        )
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["act"], "2026-08-20")
        self.assertIsNone(items[0]["due"])

    def test_blanks_a_date_that_is_not_a_day(self) -> None:
        items = handler.extract_items(
            response([{"title": "chase the refund", "act": "next week", "due": "soon"}]), CATEGORIES
        )
        self.assertIsNone(items[0]["act"])
        self.assertIsNone(items[0]["due"])

    def test_falls_back_to_the_first_category_when_one_is_invented(self) -> None:
        items = handler.extract_items(response([{"title": "x", "category": "finance"}]), CATEGORIES)
        self.assertEqual(items[0]["category"], "health")

    def test_rejects_output_that_is_not_json(self) -> None:
        with self.assertRaises(handler.ModelFailure):
            handler.extract_items(response("here are your items!"), CATEGORIES)

    def test_rejects_output_with_no_items_array(self) -> None:
        block = MagicMock(type="text", text=json.dumps({"drafts": []}))
        reply = MagicMock(content=[block], stop_reason="end_turn", usage=None)
        with self.assertRaises(handler.ModelFailure):
            handler.extract_items(reply, CATEGORIES)

    def test_rejects_output_where_nothing_has_a_title(self) -> None:
        with self.assertRaises(handler.ModelFailure):
            handler.extract_items(response([{"title": "  "}, {"category": "home"}]), CATEGORIES)

    def test_rejects_a_refusal(self) -> None:
        with self.assertRaises(handler.ModelFailure):
            handler.extract_items(response([], stop_reason="refusal"), CATEGORIES)


class Handler(unittest.TestCase):
    def event(self, body: object) -> dict[str, object]:
        return {
            "body": body if isinstance(body, str) else json.dumps(body),
            "requestContext": {"authorizer": {"jwt": {"claims": {"sub": "user-1"}}}},
        }

    def setUp(self) -> None:
        self.calls: list[dict[str, object]] = []

        def create(**kwargs: object) -> MagicMock:
            self.calls.append(kwargs)
            return response([{"title": "book the dentist", "category": "health"}])

        fake = MagicMock()
        fake.messages.create = create
        handler._client = fake

    def tearDown(self) -> None:
        handler._client = None

    def test_returns_items_and_never_the_key(self) -> None:
        reply = handler.lambda_handler(
            self.event(
                {
                    "text": "book the dentist",
                    "today": "2026-08-17",
                    "categories": CATEGORIES,
                    "existing": [],
                }
            ),
            None,
        )
        self.assertEqual(reply["statusCode"], 200)
        body = json.loads(reply["body"])
        self.assertEqual(body["items"][0]["title"], "book the dentist")

    def test_caches_the_static_system_block_and_keeps_today_out_of_it(self) -> None:
        handler.lambda_handler(
            self.event(
                {
                    "text": "book the dentist",
                    "today": "2026-08-17",
                    "categories": CATEGORIES,
                    "existing": [],
                }
            ),
            None,
        )
        system = self.calls[0]["system"]
        self.assertEqual(system[0]["cache_control"], {"type": "ephemeral"})
        # Anything per-call in the cached prefix would invalidate it on every request.
        self.assertNotIn("2026-08-17", system[0]["text"])
        self.assertEqual(self.calls[0]["model"], handler.MODEL)
        self.assertIn("json_schema", json.dumps(self.calls[0]["output_config"]))

    def test_a_bad_body_is_a_400(self) -> None:
        self.assertEqual(handler.lambda_handler(self.event("not json"), None)["statusCode"], 400)
        self.assertEqual(handler.lambda_handler(self.event({}), None)["statusCode"], 400)

    def test_a_model_failure_is_a_502_so_the_client_can_degrade(self) -> None:
        def boom(**_: object) -> MagicMock:
            raise RuntimeError("connection reset")

        handler._client.messages.create = boom
        reply = handler.lambda_handler(
            self.event(
                {
                    "text": "book the dentist",
                    "today": "2026-08-17",
                    "categories": CATEGORIES,
                    "existing": [],
                }
            ),
            None,
        )
        self.assertEqual(reply["statusCode"], 502)
        self.assertNotIn("connection reset", reply["body"])


if __name__ == "__main__":
    unittest.main()
