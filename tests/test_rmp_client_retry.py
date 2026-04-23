import json

import pytest
import requests

from rmp_scraper.rmp_client import post_graphql_with_retry


class DummyResponse:
    def __init__(self, status_code=200, payload=None, json_error=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {"data": {"ok": True}}
        self._json_error = json_error

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(
                f"http {self.status_code}",
                response=self,
            )

    def json(self):
        if self._json_error is not None:
            raise self._json_error
        return self._payload


class DummySession:
    def __init__(self, responses=None, errors=None):
        self._responses = list(responses or [])
        self._errors = list(errors or [])
        self.calls = 0

    def post(self, *_args, **_kwargs):
        self.calls += 1
        if self._errors:
            raise self._errors.pop(0)
        if not self._responses:
            raise AssertionError("No more configured responses")
        return self._responses.pop(0)


def test_retry_then_success_uses_exponential_backoff_with_jitter():
    session = DummySession(
        responses=[
            DummyResponse(status_code=500),
            DummyResponse(status_code=200, payload={"data": {"success": True}}),
        ]
    )
    sleeps = []

    result = post_graphql_with_retry(
        session=session,
        payload={"query": "query {}"},
        max_retries=3,
        base_backoff_seconds=1.0,
        sleep_fn=sleeps.append,
        random_fn=lambda: 0.5,  # jitter 0.5s
    )

    assert result == {"data": {"success": True}}
    assert session.calls == 2
    assert sleeps == [1.5]


def test_terminal_failure_after_retries_on_timeout_and_json_decode():
    session = DummySession(
        responses=[
            DummyResponse(status_code=200, json_error=json.JSONDecodeError("bad", "x", 0)),
            DummyResponse(status_code=200, json_error=json.JSONDecodeError("bad", "x", 0)),
        ]
    )
    sleeps = []

    with pytest.raises(RuntimeError, match="GraphQL request failed after 2 attempts"):
        post_graphql_with_retry(
            session=session,
            payload={"query": "query {}"},
            max_retries=1,
            base_backoff_seconds=2.0,
            sleep_fn=sleeps.append,
            random_fn=lambda: 0.25,
        )

    assert session.calls == 2
    assert sleeps == [2.5]


def test_non_retryable_4xx_raises_immediately_without_sleep():
    session = DummySession(
        responses=[DummyResponse(status_code=400)]
    )
    sleeps = []

    with pytest.raises(requests.HTTPError):
        post_graphql_with_retry(
            session=session,
            payload={"query": "query {}"},
            max_retries=3,
            base_backoff_seconds=1.0,
            sleep_fn=sleeps.append,
            random_fn=lambda: 0.9,
        )

    assert session.calls == 1
    assert sleeps == []
