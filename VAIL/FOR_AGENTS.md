# VAIL Stability API -- Agent Context

When working with VAIL stability or divergence data, use the `vail_client.py` SDK in this project.

## What the Data Means

**Stability scores** (0.0-1.0) measure whether an LLM endpoint's behavior has been consistent over the last 72 hours. Above 0.9 = stable, 0.75-0.9 = moderately stable, below 0.75 = significant behavioral shift detected, `None` = insufficient data. A drop in stability typically means the provider updated the model or changed serving infrastructure.

**Divergence ratios** measure how much a provider's behavior differs from other providers serving the same model. Near 1.0 = consistent with the group, above 1.0 = diverging from other providers, below 1.0 = more consistent than average. For example, if Claude Sonnet 4.6 on Bedrock has a divergence ratio of 2.0 while Azure, Vertex, and Anthropic are near 1.0, Bedrock is producing meaningfully different outputs.

## Setup

The SDK requires `httpx` (`pip install httpx`) and an API key set as the `VAIL_API_KEY` environment variable.

## Usage

```python
from vail_client import VailClient

client = VailClient()

# List available endpoints
endpoints = client.list_endpoints()

# Get current stability score for an endpoint
score = client.get_stability("gpt-4o-azure-chat")
print(score.stability_score)  # 0.0-1.0, or None if insufficient data

# Get historical stability (daily or hourly)
history = client.get_stability_historical("gpt-4o-azure-chat", "2026-02-01", "2026-02-28")
for dp in history.data:
    print(dp.timestamp, dp.stability_score)

# Provider divergence ratios
divergence = client.get_divergence("gpt-4o-azure-chat", "2026-02-01", "2026-02-28")
for dp in divergence.data:
    print(dp.date, dp.divergence_ratio, dp.comparison_providers)
```

## Key Details

- All errors raise `VailAPIError` with `.status_code` and `.detail`.
- `stability_score` is `None` when fewer than 5 observations exist in the 72-hour lookback window.
- Historical stability is capped at 360 data points per request (~15 days hourly, ~360 days daily).
- Read `vail_client.py` for full method signatures and type definitions.
