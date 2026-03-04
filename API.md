# Inference Provider Leaderboard API

This project exposes a public, read-only API as static JSON files under:

- `/api/v1/index.json`

Because the site is statically exported, these endpoints are generated at build time by:

- `node scripts/generate-manifest.mjs`

## Endpoints

Core endpoints:

- `/api/v1/meta.json`
- `/api/v1/runs.json`
- `/api/v1/runs/index.json`
- `/api/v1/runs/by-date/{YYYY-MM-DD}.json`
- `/api/v1/models.json`
- `/api/v1/models/{model_id}.json` (`model_id` is URL-encoded model name)
- `/api/v1/leaderboard.json`
- `/api/v1/summary.json`

Contract endpoints:

- `/api/v1/schemas/index.schema.json`
- `/api/v1/schemas/meta.schema.json`
- `/api/v1/schemas/run.schema.json`
- `/api/v1/schemas/runs.schema.json`
- `/api/v1/schemas/runs-index.schema.json`
- `/api/v1/schemas/runs-by-date.schema.json`
- `/api/v1/schemas/models.schema.json`
- `/api/v1/schemas/model-detail.schema.json`
- `/api/v1/schemas/leaderboard.schema.json`
- `/api/v1/schemas/summary.schema.json`

Raw data endpoints:

- `/data/manifest.json` (raw audit file list)
- `/data/{filename}.json` (raw audit result files)

## Data Notes

- Timestamps are emitted in UTC RFC3339 format (`YYYY-MM-DDTHH:MM:SSZ`).
- Provider entries without a valid numeric `exact_match_rate` are removed from API responses.
- `runs.json` remains the complete dataset snapshot.
- `runs/index.json` + `runs/by-date/*.json` support incremental pulls by date.
- URL fields (`endpoint`, `dataUrl`) are emitted as relative paths.
- Every run includes `providerEntries` (normalized array with `endpoint`, `provider`, `variant`, and `metrics`).
- `summary.json` is the compact embedding endpoint (leaderboard plus the latest run per model).

## Compatibility Notes

- API versioning uses path prefixes (`/api/v1/...`).
- Additive fields may appear in provider metrics over time. Consumers should treat unknown metric keys as forward-compatible.
- JSON Schemas in `/api/v1/schemas/` are the canonical contract for v1 payload shape.

## Ignoring Models

You can exclude models globally (API payloads and site rendering) by editing:

- `/public/data/api-config.json`

Example:

```json
{
  "ignoredModels": ["Qwen/Qwen3-8B"]
}
```

Then regenerate the static API:

```bash
node scripts/generate-manifest.mjs
```
