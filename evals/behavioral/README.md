# Behavioral Evaluations

These evaluations are contributor infrastructure, not a guarantee that every model follows every workflow.

## Offline Replay

Run `npm test`. Replay requires no model, network, or credentials and rejects stale skill or case hashes.

## Live Run

Install OpenCode 2 and provide the selected provider's API key through its supported environment variable, then run `OPENCODE_EVAL_MODEL=provider/model npm run eval:behavioral` from a source checkout. An optional model variant uses `provider/model#variant`. This live runner targets the V2 session API; OpenCode 1 remains supported by the plugin and smoke tests.

The runner uses an empty temporary project, denies model-facing tools, and writes only a redacted report to `.artifacts/behavioral-evals/latest.json`. It accepts text only from a successfully completed turn; failed or interrupted turns remain incomplete even if partial text matches the oracles.

Native OpenCode 2 login credentials live in its database and are not copied into the isolated runtime. A legacy `auth.json`, when present, is copied for migration compatibility, but can be absent or stale. Use environment credentials for reproducible live runs; the runner does not copy your session database.

## Review And Acceptance

Review the report for complete case coverage, passing oracles, and redaction. Then run `npm run eval:behavioral:accept`. Acceptance is explicit, deterministic, and unavailable for failed, incomplete, stale, duplicate, or partial reports.

## Path Overrides

Tests and scripted runs isolate evaluation output with `BEHAVIORAL_EVAL_LATEST_PATH` (default `.artifacts/behavioral-evals/latest.json`) and `BEHAVIORAL_EVAL_SNAPSHOTS_PATH` (default `evals/behavioral/snapshots.json`). Both must be absolute paths and override only the live report and snapshot file respectively; cases, mutations, and the runner itself are always read from the repository.

## Safety

Fixtures contain only clearly fictitious `sk-eval-*` values. Do not add real credentials, private repository content, raw OpenCode events, or user-project paths to cases, reports, or snapshots.
