"""Unit tests for telemetry service helpers."""

from types import SimpleNamespace

import pytest

from app.services.telemetry import _get_bin_by_code


class _DummyResult:
    def __init__(self, value: object | None) -> None:
        self._value = value

    def scalar_one_or_none(self) -> object | None:
        return self._value


class _DummySession:
    def __init__(self, responses: list[object | None]) -> None:
        self._responses = list(responses)
        self.calls = 0

    async def execute(self, _stmt):  # type: ignore[no-untyped-def]
        self.calls += 1
        if self._responses:
            return _DummyResult(self._responses.pop(0))
        return _DummyResult(None)


@pytest.mark.asyncio
async def test_get_bin_by_code_accepts_hyphen_variant() -> None:
    """Lookup should accept BIN-001 when stored code is BIN_001."""
    db = _DummySession([None, SimpleNamespace(id=101, bin_code="BIN_001")])

    bin_obj = await _get_bin_by_code(db, "BIN-001", org_id=3)

    assert bin_obj is not None
    assert getattr(bin_obj, "bin_code") == "BIN_001"
    assert db.calls == 2


@pytest.mark.asyncio
async def test_get_bin_by_code_accepts_underscore_variant() -> None:
    """Lookup should accept BIN_001 when stored code is BIN-001."""
    db = _DummySession([None, SimpleNamespace(id=102, bin_code="BIN-001")])

    bin_obj = await _get_bin_by_code(db, "BIN_001", org_id=3)

    assert bin_obj is not None
    assert getattr(bin_obj, "bin_code") == "BIN-001"
    assert db.calls == 2


@pytest.mark.asyncio
async def test_get_bin_by_code_raises_with_original_input() -> None:
    """Error detail should preserve caller-provided code for debugging."""
    db = _DummySession([None, None])

    with pytest.raises(ValueError, match="bin not found: BIN_404"):
        await _get_bin_by_code(db, "BIN_404", org_id=3)


@pytest.mark.asyncio
async def test_get_bin_by_code_has_case_insensitive_fallback() -> None:
    """Lookup should tolerate case differences in stored bin codes."""
    db = _DummySession([None, None, SimpleNamespace(id=103, bin_code="Bin_001")])

    bin_obj = await _get_bin_by_code(db, "BIN_001", org_id=3)

    assert bin_obj is not None
    assert getattr(bin_obj, "bin_code") == "Bin_001"
