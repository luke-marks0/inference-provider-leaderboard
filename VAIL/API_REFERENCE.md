# VAIL Stability API Reference

Base URL: `https://api.projectvail.com`

The VAIL Stability API provides read-only access to endpoint stability scores and provider divergence metrics. Use it to monitor the behavioral consistency of LLM endpoints over time and compare divergence across providers serving the same model.

## Table of Contents

- [VAIL Stability API Reference](#vail-stability-api-reference)
  - [Table of Contents](#table-of-contents)
  - [Concepts](#concepts)
    - [Stability Scores](#stability-scores)
    - [Provider Divergence](#provider-divergence)
  - [Authentication](#authentication)
  - [Endpoints](#endpoints)
    - [`GET /v1/endpoints`](#get-v1endpoints)
      - [Request](#request)
      - [Response](#response)
      - [Example](#example)
    - [`GET /v1/stability`](#get-v1stability)
      - [Request](#request-1)
      - [Validation Rules](#validation-rules)
      - [Response: Single-Point Mode](#response-single-point-mode)
      - [Response: Historical Mode](#response-historical-mode)
      - [Examples](#examples)
    - [`GET /v1/divergence`](#get-v1divergence)
      - [Request](#request-2)
      - [Validation Rules](#validation-rules-1)
      - [Response](#response-1)
      - [Example](#example-1)
  - [Rate Limiting](#rate-limiting)
  - [Error Responses](#error-responses)
  - [Endpoint Naming Convention](#endpoint-naming-convention)

---

## Concepts

### Stability Scores

VAIL continuously monitors LLM endpoints by collecting behavioral fingerprints -- statistical signatures of an endpoint's output distribution. A **stability score** measures whether an endpoint's behavior has remained consistent over a trailing 72-hour window.

The score ranges from **0.0 to 1.0**:

- **Above 0.9** -- Stable. All or nearly all recent fingerprints are consistent with the endpoint's expected behavior. No significant shifts detected.
- **0.75 - 0.9** -- Moderately stable. Some fingerprints showed behavioral changes, but the endpoint is largely consistent. Worth monitoring.
- **Below 0.75** -- Unstable. A significant portion of fingerprints indicate the endpoint's behavior has shifted. This could mean the provider updated the model, changed serving infrastructure, or introduced a regression.
- **null** -- Insufficient data. Fewer than 5 fingerprint observations exist in the 72-hour window, so a reliable score cannot be computed.

Stability scores are useful for tracking whether a provider endpoint is behaving consistently over time. A sudden drop in stability can indicate a model update, a serving change, or a transient issue.

### Provider Divergence

When multiple providers serve the same model (e.g. Claude Sonnet 4.6 on Azure, Vertex, Bedrock, and Anthropic), VAIL computes a daily **divergence ratio** for each provider by comparing its behavioral fingerprints against the other providers serving that model.

The divergence ratio is centered around **1.0**:

- **Near 1.0** -- The provider's behavior is as consistent with the consensus as the typical provider's behavior is.
- **Above 1.0** -- The provider is diverging from the group. Its outputs differ more from the consensus than the average provider's outputs do.
- **Below 1.0** -- The provider is closer to the consensus than the majority of other providers are.

For example, if VAIL monitors Claude Sonnet 4.6 across all four providers and Bedrock's divergence ratio is 2.0 while Azure, Vertex, and Anthropic are near 1.0, that signals Bedrock's serving of the model is producing meaningfully different outputs from the other three.

Each divergence data point also includes a `comparison_providers` list showing which other providers were part of the comparison on that date. Divergence is useful for detecting when a specific provider's serving of a model drifts away from the pack -- for example, if one provider applies different quantization, uses a different model version, or has serving-layer differences that affect output.

To see provider divergence visualized in practice, visit the [Provider Comparisons](https://arena.projectvail.com/?tab=provider-comparisons) tab on VAIL's Stability Arena.

---

## Authentication

All requests require an API key passed via the `X-API-Key` header.

```
X-API-Key: your-api-key-here
```

Your API key is scoped to a specific customer and grants access to a predefined set of endpoints. If your key is invalid, inactive, or missing, the API returns `401`. If you request an endpoint your key does not have access to, the API returns `403`.

API keys are issued by VAIL. Contact your VAIL representative to obtain or rotate a key.

---

## Endpoints

### `GET /v1/endpoints`

List all endpoints your API key has access to.

#### Request

| Component | Name | Required | Description |
|-----------|------|----------|-------------|
| Header | `X-API-Key` | Yes | Your API key |

No query parameters.

#### Response

```json
{
  "endpoints": [
    { "name": "gpt-4o-vertex-chat" },
    { "name": "gpt-4o-azure-chat" },
    { "name": "claude-3-anthropic-chat" }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `endpoints` | array | List of endpoint objects |
| `endpoints[].name` | string | The endpoint identifier to use in other API calls |

#### Example

```bash
curl -H "X-API-Key: $VAIL_API_KEY" \
  https://api.projectvail.com/v1/endpoints
```

---

### `GET /v1/stability`

Get stability scores for an endpoint. The stability score measures the behavioral consistency of an LLM endpoint over a trailing 72-hour window. A score of `1.0` means fully stable (no anomalous behavior detected); a score near `0.0` indicates significant instability.

This endpoint supports two modes: **single-point** and **historical**.

#### Request

| Component | Name | Required | Description |
|-----------|------|----------|-------------|
| Header | `X-API-Key` | Yes | Your API key |
| Query | `endpoint` | Yes | Endpoint name (from `/v1/endpoints`) |
| Query | `timestamp` | No | ISO 8601 datetime for single-point mode (e.g. `2026-03-01T12:00:00Z`). Mutually exclusive with `start_date`/`end_date`. |
| Query | `start_date` | No | Start date for historical mode (`YYYY-MM-DD`). Requires `end_date`. |
| Query | `end_date` | No | End date for historical mode (`YYYY-MM-DD`). Requires `start_date`. |
| Query | `granularity` | No | `"hourly"` or `"daily"` (default: `"daily"`). Only applies to historical mode. |

**Mode selection:**

- **Single-point (default):** Omit `start_date` and `end_date`. Optionally provide `timestamp` to query a specific point in time; if omitted, the current time is used.
- **Historical:** Provide both `start_date` and `end_date` to get a time series of stability scores.

#### Validation Rules

- `timestamp` and `start_date`/`end_date` are mutually exclusive.
- `start_date` and `end_date` must both be provided or both omitted.
- `start_date` must be on or before `end_date`.
- Historical mode is capped at 360 data points (e.g. 15 days at hourly granularity, or 360 days at daily granularity).

#### Response: Single-Point Mode

```json
{
  "endpoint": "gpt-4o-azure-chat",
  "timestamp": "2026-03-01T12:00:00Z",
  "stability_score": 0.95
}
```

| Field | Type | Description |
|-------|------|-------------|
| `endpoint` | string | The queried endpoint name |
| `timestamp` | string (ISO 8601) | The point in time evaluated |
| `stability_score` | float or null | Stability score from 0.0 to 1.0, or `null` if insufficient data (fewer than 5 observations in the 72-hour window) |

#### Response: Historical Mode

```json
{
  "endpoint": "gpt-4o-azure-chat",
  "start_date": "2026-02-25",
  "end_date": "2026-02-28",
  "granularity": "daily",
  "data": [
    { "timestamp": "2026-02-25T00:00:00Z", "stability_score": 1.0 },
    { "timestamp": "2026-02-26T00:00:00Z", "stability_score": 0.92 },
    { "timestamp": "2026-02-27T00:00:00Z", "stability_score": null },
    { "timestamp": "2026-02-28T00:00:00Z", "stability_score": 0.88 }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `endpoint` | string | The queried endpoint name |
| `start_date` | string (date) | Inclusive start of the range |
| `end_date` | string (date) | Inclusive end of the range |
| `granularity` | string | `"hourly"` or `"daily"` |
| `data` | array | Time series of stability data points |
| `data[].timestamp` | string (ISO 8601) | The point in time evaluated |
| `data[].stability_score` | float or null | Stability score, or `null` if insufficient data |

A `null` stability score means fewer than 5 fingerprint observations existed in the 72-hour lookback window for that data point. The data point is still included in the response to preserve the time grid and make gaps visible.

#### Examples

Single-point at a specific time:

```bash
curl -H "X-API-Key: $VAIL_API_KEY" \
  "https://api.projectvail.com/v1/stability?endpoint=gpt-4o-azure-chat&timestamp=2026-03-01T12:00:00Z"
```

Single-point at the current time:

```bash
curl -H "X-API-Key: $VAIL_API_KEY" \
  "https://api.projectvail.com/v1/stability?endpoint=gpt-4o-azure-chat"
```

Historical, daily granularity:

```bash
curl -H "X-API-Key: $VAIL_API_KEY" \
  "https://api.projectvail.com/v1/stability?endpoint=gpt-4o-azure-chat&start_date=2026-02-25&end_date=2026-02-28"
```

Historical, hourly granularity:

```bash
curl -H "X-API-Key: $VAIL_API_KEY" \
  "https://api.projectvail.com/v1/stability?endpoint=gpt-4o-azure-chat&start_date=2026-02-25&end_date=2026-02-28&granularity=hourly"
```

---

### `GET /v1/divergence`

Get daily divergence ratios for an endpoint over a date range. The divergence ratio quantifies how much an endpoint's behavior diverges from other providers serving the same model. A ratio near `1.0` indicates behavior consistent with the provider consensus; higher values indicate greater divergence.

#### Request

| Component | Name | Required | Description |
|-----------|------|----------|-------------|
| Header | `X-API-Key` | Yes | Your API key |
| Query | `endpoint` | Yes | Endpoint name (from `/v1/endpoints`) |
| Query | `start_date` | Yes | Inclusive start date (`YYYY-MM-DD`) |
| Query | `end_date` | Yes | Inclusive end date (`YYYY-MM-DD`) |

#### Validation Rules

- `start_date` must be on or before `end_date`.

#### Response

```json
{
  "endpoint": "gpt-4o-vertex-chat",
  "start_date": "2026-02-01",
  "end_date": "2026-02-28",
  "data": [
    {
      "date": "2026-02-01",
      "divergence_ratio": 1.02,
      "comparison_providers": ["azure", "openai", "anthropic"]
    },
    {
      "date": "2026-02-02",
      "divergence_ratio": 0.98,
      "comparison_providers": ["azure", "openai"]
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `endpoint` | string | The queried endpoint name |
| `start_date` | string (date) | Inclusive start of the range |
| `end_date` | string (date) | Inclusive end of the range |
| `data` | array | Daily divergence data points |
| `data[].date` | string (date) | The date of the measurement |
| `data[].divergence_ratio` | float | Divergence ratio for this endpoint on this date |
| `data[].comparison_providers` | array of strings | Other providers included in the divergence comparison for this date |

The `data` array only contains entries for dates where divergence data exists. If no divergence data is available for the queried endpoint, `data` will be an empty array.

#### Example

```bash
curl -H "X-API-Key: $VAIL_API_KEY" \
  "https://api.projectvail.com/v1/divergence?endpoint=gpt-4o-vertex-chat&start_date=2026-02-01&end_date=2026-02-28"
```

---

## Rate Limiting

Each API key has an individual rate limit (default: 100 requests/minute). When exceeded, the API returns `429` with a `detail` message indicating when the limit resets.

---

## Error Responses

All errors follow a consistent format:

```json
{
  "detail": "Description of the error"
}
```

| Status Code | Meaning | Common Causes |
|-------------|---------|---------------|
| 400 | Bad Request | Invalid parameter combination, date range violation, or exceeding the 360 data-point limit |
| 401 | Unauthorized | Missing, invalid, or inactive API key |
| 403 | Forbidden | API key does not have access to the requested endpoint |
| 404 | Not Found | Endpoint name not recognized for your account |
| 422 | Unprocessable Entity | Malformed query parameters (e.g. invalid date format) |
| 429 | Too Many Requests | Rate limit exceeded |

---

## Endpoint Naming Convention

Endpoint names follow the format `{model}-{provider}-{type}`:

- `gpt-4.1-azure-chat` -- GPT-4.1 on Azure, chat completions
- `gpt-4.1-azure-responses` -- GPT-4.1 on Azure, responses API
- `claude-3-anthropic-chat` -- Claude 3 on Anthropic, chat completions

Use `/v1/endpoints` to discover the exact names available to your API key.
