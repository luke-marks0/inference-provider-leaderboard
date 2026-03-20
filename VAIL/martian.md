# VAIL Stability API -- Martian Integration Guide

Welcome! This guide gets your team from zero to pulling VAIL divergence data into your leaderboard.

Your use case: Martian's leaderboard shows differences in model serving across provider endpoints. VAIL provides **divergence ratios** that measure how much each provider's behavior diverges from the consensus for a given model. You'll pull this data per date and per endpoint, and plot it alongside your existing accuracy metrics to give a fuller picture of provider quality over time.

---

## Setup (5 minutes)

### 1. Add the SDK

Copy the included `vail_client.py` into your project (e.g. `lib/vail_client.py` or wherever you keep client modules). Install the one dependency:

```bash
pip install httpx
```

### 2. Set your API key

```bash
export VAIL_API_KEY="your-api-key-here"
```

Or add `VAIL_API_KEY=your-api-key-here` to your `.env` file. Never commit this to source control.

### 3. Add agent context

Drop the included `FOR_AGENTS.md` into your project so your coding agent knows how to use the SDK:

- **Cursor:** copy to `.cursor/rules/vail.md`
- **Claude Code:** append contents to `CLAUDE.md` in your project root
- **Codex:** include in your system prompt or project instructions

---

## Integration Prompt

Review the prompt below, fill in the bracketed paths for your codebase, and paste it into your coding agent. This is the only step that requires knowledge of your codebase -- everything else is pre-configured.

> Read `vail_client.py` to understand the VAIL SDK. We need to integrate VAIL provider divergence data into our leaderboard.
>
> **What VAIL divergence data is:** For each provider endpoint serving a given model (e.g. GPT-4o on Azure vs. GPT-4o on Vertex), VAIL computes a daily divergence ratio measuring how much that provider's behavior diverges from the consensus of all providers serving the same model. A ratio near 1.0 means the provider is consistent with the group; significantly higher values (e.g. 2.0) mean it's behaving very differently. The `comparison_providers` field tells you which other providers were part of the comparison on each date.
>
> **What to build:**
>
> 1. In `[path/to/your/data-fetching-module]`, add a function that pulls divergence data from VAIL:
>    - Use `VailClient.list_endpoints()` to discover all available endpoints. Endpoint names follow the format `{model}-{provider}-{type}` (e.g. `gpt-4o-azure-chat`, `gpt-4o-vertex-chat`). Group endpoints by model so you can compare providers serving the same model.
>    - For each endpoint, call `VailClient.get_divergence(endpoint, start_date, end_date)` to get daily divergence ratios over the requested date range.
>    - The API key comes from the `VAIL_API_KEY` environment variable.
>
> 2. In `[path/to/your/backend-route-or-api]`, expose this data to the frontend. The response should be structured so the frontend can plot, for a given model, one line per provider showing divergence ratio over time. Include the `comparison_providers` list so the UI can show which providers were compared.
>
> 3. In `[path/to/your/leaderboard-component]`, add a divergence chart alongside the existing accuracy metrics:
>    - For each model on the leaderboard, show a time-series chart with one line per provider (color-coded). The x-axis is date, the y-axis is divergence ratio.
>    - This data is complementary to the accuracy metrics you're already plotting -- divergence measures behavioral consistency across providers, while accuracy measures closeness to a reference provider.
>    - Add a date range selector. Default to the last 30 days.
>    - If no divergence data exists for a model (empty `data` array), show a "No divergence data available" message rather than an empty chart.
>
> 4. Handle errors gracefully: if the VAIL API is unreachable or returns an error, the leaderboard should still show accuracy data and indicate that divergence data is temporarily unavailable.

---

## Verifying it works

After your agent writes the code, do a quick sanity check:

```python
from vail_client import VailClient

client = VailClient()

# See what endpoints you have access to
endpoints = client.list_endpoints()
print(endpoints)

# Pull divergence data for one endpoint
result = client.get_divergence(endpoints[0], "2026-02-01", "2026-02-28")
for dp in result.data:
    print(dp.date, dp.divergence_ratio, dp.comparison_providers)
```

If `list_endpoints()` returns names and `get_divergence()` returns data, you're live.

## Support

Contact your VAIL representative if you need:
- Additional endpoints added to your API key
- A higher rate limit (default is 100 requests/minute)
- Help with your integration
