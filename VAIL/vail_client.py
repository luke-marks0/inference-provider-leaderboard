"""VAIL Stability API Python client.

Single-file SDK for querying LLM endpoint stability scores and provider
divergence metrics from the VAIL API.

    pip install httpx

Usage::

    from vail_client import VailClient

    client = VailClient("your-api-key")

    endpoints = client.list_endpoints()
    score = client.get_stability("gpt-4o-azure-chat")
    history = client.get_stability_historical("gpt-4o-azure-chat", "2026-02-01", "2026-02-28")
    divergence = client.get_divergence("gpt-4o-azure-chat", "2026-02-01", "2026-02-28")
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Literal

import httpx

DEFAULT_BASE_URL = "https://api.projectvail.com"


class VailAPIError(Exception):
    """Raised when the VAIL API returns a non-2xx response."""

    def __init__(self, status_code: int, detail: str) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"HTTP {status_code}: {detail}")


# ---------------------------------------------------------------------------
# Response types
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class StabilityScore:
    """Single-point stability result."""

    endpoint: str
    timestamp: str
    stability_score: float | None


@dataclass(frozen=True, slots=True)
class StabilityDataPoint:
    """One data point in a historical stability time series."""

    timestamp: str
    stability_score: float | None


@dataclass(frozen=True, slots=True)
class StabilityHistory:
    """Historical stability result over a date range."""

    endpoint: str
    start_date: str
    end_date: str
    granularity: str
    data: list[StabilityDataPoint]


@dataclass(frozen=True, slots=True)
class DivergenceDataPoint:
    """One day of divergence data."""

    date: str
    divergence_ratio: float
    comparison_providers: list[str]


@dataclass(frozen=True, slots=True)
class DivergenceResult:
    """Divergence result over a date range."""

    endpoint: str
    start_date: str
    end_date: str
    data: list[DivergenceDataPoint]


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


class VailClient:
    """Synchronous client for the VAIL Stability API.

    Args:
        api_key: Your VAIL API key. If not provided, reads from the
            ``VAIL_API_KEY`` environment variable.
        base_url: API base URL. Defaults to ``https://api.projectvail.com``.
        timeout: Request timeout in seconds. Defaults to 30.
    """

    def __init__(
        self,
        api_key: str | None = None,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 30,
    ) -> None:
        resolved_key = api_key or os.environ.get("VAIL_API_KEY")
        if not resolved_key:
            raise ValueError(
                "No API key provided. Pass api_key= or set the VAIL_API_KEY environment variable."
            )
        self._base_url = base_url.rstrip("/")
        self._client = httpx.Client(
            base_url=self._base_url,
            headers={"X-API-Key": resolved_key},
            timeout=timeout,
        )

    def close(self) -> None:
        """Close the underlying HTTP connection pool."""
        self._client.close()

    def __enter__(self) -> VailClient:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    # -- internal ------------------------------------------------------------

    def _request(self, path: str, params: dict | None = None) -> dict:
        resp = self._client.get(path, params=params)
        if resp.status_code != 200:
            detail = resp.json().get("detail", resp.text) if resp.headers.get("content-type", "").startswith("application/json") else resp.text
            raise VailAPIError(resp.status_code, detail)
        return resp.json()

    # -- public API ----------------------------------------------------------

    def list_endpoints(self) -> list[str]:
        """Return the endpoint names your API key can access.

        Returns:
            A list of endpoint name strings (e.g. ``["gpt-4o-azure-chat", ...]``).
        """
        data = self._request("/v1/endpoints")
        return [ep["name"] for ep in data["endpoints"]]

    def get_stability(
        self,
        endpoint: str,
        timestamp: str | datetime | None = None,
    ) -> StabilityScore:
        """Get the current stability score for an endpoint.

        Args:
            endpoint: Endpoint name (from :meth:`list_endpoints`).
            timestamp: Optional ISO 8601 datetime string or ``datetime`` object.
                If omitted, the API evaluates at the current time.

        Returns:
            A :class:`StabilityScore` with the endpoint name, timestamp, and
            score (0.0--1.0, or ``None`` if insufficient data).
        """
        params: dict[str, str] = {"endpoint": endpoint}
        if timestamp is not None:
            ts = timestamp.isoformat() if isinstance(timestamp, datetime) else timestamp
            params["timestamp"] = ts

        data = self._request("/v1/stability", params)
        return StabilityScore(
            endpoint=data["endpoint"],
            timestamp=data["timestamp"],
            stability_score=data["stability_score"],
        )

    def get_stability_historical(
        self,
        endpoint: str,
        start_date: str | date,
        end_date: str | date,
        granularity: Literal["daily", "hourly"] = "daily",
    ) -> StabilityHistory:
        """Get a time series of stability scores over a date range.

        Args:
            endpoint: Endpoint name (from :meth:`list_endpoints`).
            start_date: Inclusive start date (``YYYY-MM-DD`` string or ``date``).
            end_date: Inclusive end date (``YYYY-MM-DD`` string or ``date``).
            granularity: ``"daily"`` (default) or ``"hourly"``. Hourly is
                capped at ~15 days per request (360 data points max).

        Returns:
            A :class:`StabilityHistory` containing the time series.
        """
        params: dict[str, str] = {
            "endpoint": endpoint,
            "start_date": str(start_date),
            "end_date": str(end_date),
            "granularity": granularity,
        }
        data = self._request("/v1/stability", params)
        return StabilityHistory(
            endpoint=data["endpoint"],
            start_date=data["start_date"],
            end_date=data["end_date"],
            granularity=data["granularity"],
            data=[
                StabilityDataPoint(
                    timestamp=dp["timestamp"],
                    stability_score=dp["stability_score"],
                )
                for dp in data["data"]
            ],
        )

    def get_divergence(
        self,
        endpoint: str,
        start_date: str | date,
        end_date: str | date,
    ) -> DivergenceResult:
        """Get daily divergence ratios for an endpoint over a date range.

        The divergence ratio measures how much an endpoint's behavior diverges
        from other providers serving the same model. Values near 1.0 indicate
        consistency with the provider consensus.

        Args:
            endpoint: Endpoint name (from :meth:`list_endpoints`).
            start_date: Inclusive start date (``YYYY-MM-DD`` string or ``date``).
            end_date: Inclusive end date (``YYYY-MM-DD`` string or ``date``).

        Returns:
            A :class:`DivergenceResult` containing daily divergence data points.
        """
        params: dict[str, str] = {
            "endpoint": endpoint,
            "start_date": str(start_date),
            "end_date": str(end_date),
        }
        data = self._request("/v1/divergence", params)
        return DivergenceResult(
            endpoint=data["endpoint"],
            start_date=data["start_date"],
            end_date=data["end_date"],
            data=[
                DivergenceDataPoint(
                    date=dp["date"],
                    divergence_ratio=dp["divergence_ratio"],
                    comparison_providers=dp["comparison_providers"],
                )
                for dp in data["data"]
            ],
        )
