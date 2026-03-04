# Inference Provider Leaderboard API

This project exposes an API as static JSON files under:

- `/api/v1/index.json`

Because the site is statically exported, these endpoints are generated at build time by:

- `node scripts/generate-manifest.mjs`

## Endpoints

Core endpoints:

- `/api/v1/meta.json`: global counts (`runCount`, `modelCount`, `providerCount`) and ignored models.
- `/api/v1/runs.json`: complete run snapshot.
- `/api/v1/runs/index.json`: incremental sync index (`availableDates`, date-specific endpoint list).
- `/api/v1/runs/by-date/{YYYY-MM-DD}.json`: all runs whose timestamps fall on that UTC date.
- `/api/v1/models.json`: one row per model with timestamps and model detail endpoint.
- `/api/v1/models/{model_id}.json` (`model_id` is URL-encoded model name): full model history, provider list, runs, and timeseries.
- `/api/v1/leaderboard.json`: provider-level aggregate ranking table.
- `/api/v1/summary.json`: leaderboard plus latest run per model.

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
- Date partitions use UTC (`YYYY-MM-DD`).
- Provider entries without a valid numeric `exact_match_rate` are removed from API responses.
- `runs.json` remains the complete dataset snapshot.
- `runs/index.json` plus `runs/by-date/*.json` support incremental pulls by date.
- URL fields (`endpoint`, `dataUrl`) are emitted as relative paths.
- Every run includes `providerEntries` (normalized array with `endpoint`, `provider`, `variant`, and `metrics`).

## Field Glossary

Model and identity fields:

- `model`: canonical model name (for example, `openai/gpt-oss-120b`).
- `id`: URL-encoded `model` value, used in `/models/{model_id}.json`.
- `id` (run object): unique run identifier derived from the source filename.
- `filename`: original raw JSON filename in `/data`.
- `dataUrl`: relative path from the current API payload to the raw audit JSON.

Provider fields:

- `endpoint`: provider endpoint label, optionally including a variant suffix (for example, `nebius/fp8`).
- `provider`: normalized provider name without variant.
- `variant`: provider-reported quantization (for example, `fp8`, `bf16`) or `null`.

Metric fields (all numeric):

- `exact_match_rate`: primary quality metric used for provider filtering and aggregation.
- `total_tokens`: total evaluated token count.
- `n_sequences`: number of evaluated sequences.

Notes:

- `metrics` allows additive keys over time (`additionalProperties: true` in schema).
- `parameters` is pass-through metadata from the run generator and may vary by run.

## Edge Cases

- `latestRun` in `summary.json` may be `null` for models without valid provider entries.
- `providerEntries` may be an empty array for a run after filtering invalid `exact_match_rate` values.
- `firstTimestamp` and `lastTimestamp` can be `null` when no runs are available for a scoped payload.
- `runs/by-date/{date}.json` may exist with `count: 0` if a date is indexed but contains no valid runs after filtering.

## Ignoring Models

You can exclude models by editing:

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
