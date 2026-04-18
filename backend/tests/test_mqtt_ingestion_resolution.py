"""Unit tests for MQTT ingestion bin/device token resolution helpers."""

from types import SimpleNamespace

import pytest

from app.services.mqtt_ingestion import _resolve_bin_and_device, _token_candidates


class _DummyResult:
    def __init__(self, value: object | None) -> None:
        self._value = value

    def scalar_one_or_none(self) -> object | None:
        return self._value


class _DummySession:
    def __init__(self, responses: list[object | None]) -> None:
        self._responses = list(responses)

    async def execute(self, _stmt):  # type: ignore[no-untyped-def]
        if self._responses:
            return _DummyResult(self._responses.pop(0))
        return _DummyResult(None)


def test_token_candidates_include_separator_and_case_variants() -> None:
    """Token candidate generation should include common MQTT format variants."""
    candidates = _token_candidates("BIN-001")

    assert "BIN-001" in candidates
    assert "BIN_001" in candidates
    assert "bin-001" in candidates


@pytest.mark.asyncio
async def test_resolve_bin_and_device_accepts_separator_variant() -> None:
    """Resolver should map BIN-001 token to BIN_001 bin code when needed."""
    bin_obj = SimpleNamespace(id=101, bin_code="BIN_001")
    fallback_device = SimpleNamespace(id=201, bin_id=101)

    # Device exact probes (3), bin exact probes (2nd hit), fallback device lookup.
    db = _DummySession([None, None, None, None, bin_obj, fallback_device])

    resolved_bin, resolved_device = await _resolve_bin_and_device(db, "BIN-001")

    assert resolved_bin is not None
    assert getattr(resolved_bin, "bin_code") == "BIN_001"
    assert resolved_device is not None
    assert getattr(resolved_device, "bin_id") == 101


@pytest.mark.asyncio
async def test_resolve_bin_and_device_has_case_insensitive_fallback() -> None:
    """Resolver should still find bin when DB casing differs from MQTT token."""
    mixed_case_bin = SimpleNamespace(id=102, bin_code="Bin_001")

    # Device exact probes (3), bin exact probes (3), device lower() probe,
    # bin lower() probe (hit), fallback device lookup.
    db = _DummySession([None, None, None, None, None, None, None, mixed_case_bin, None])

    resolved_bin, resolved_device = await _resolve_bin_and_device(db, "BIN_001")

    assert resolved_bin is not None
    assert getattr(resolved_bin, "bin_code") == "Bin_001"
    assert resolved_device is None
