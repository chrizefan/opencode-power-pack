# OpenCode 2 compatibility implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. Review the frozen PRs with the code-review skill.

**Goal:** Make the 55 bundled skills and three specialist agents work in OpenCode 2 while retaining OpenCode 1.18.7 compatibility.

**Architecture:** Integrate PR #45 into current main without committing, retain its dual `setup`/`server` entrypoint and shared permission source, and repair confirmed gaps. Add the root directory entrypoint from the approach in PR #52. Preserve existing workflows, licenses, user-defined agents, and the other supported hosts.

**Tech stack:** Node.js >=20.11.0, ES modules, node:test, npm, GitHub Actions.

**Spec:** User request to evaluate the existing PR, plan the upgrade and execute it; https://opencode.ai/v2/docs/migrate-v1/ and https://opencode.ai/v2/docs/build/plugins/migrate-v1/.

## Global constraints

- No commit, push, PR creation, PR merge, issue closure, or rebase without explicit user approval. Show each exact commit message before approval.
- Preserve the pre-existing untracked `2026-09-30-pr45-fixes.md` plan; it is historical context, not a current specification.
- Keep scratch data and tool execution artifacts inside `.scratch/`; pass a project-local TMPDIR when running tests.
- Keep `engines.opencode` at `>=1.18.7`; add no runtime dependencies for the plain plugin definition.
- Verify pinned V1 1.18.7, the PR's V2 baseline 2.0.14, and current npm V2 2.0.32.
- Execute locally now as requested. Defer commit and remote mutations to the final approval step.

## Review focus

- V2 configured package directories must load their own root entrypoint, without a shim masking packaging failures.
- Helpers must stay outside the automatically scanned plugins directory.
- Host mutation of one agent's permissions must not leak into other agents or later loads.
- Global allow rules must not silently defeat read-only specialist permissions on supported hosts.
- Behavioral tooling must reject malformed provider/model references and follow the real V2 session API.

### Task 1: Review and integrate the best PR locally

- [x] Freeze PR #45 at `a3523bc08f8bce2a31f0b2e54f14fef36dbe0a9c` and PR #52 at `b01f1428ca583e06b372689a74cd030a475a2748`.
- [x] Create local `feat/opencode-v2-update` from main `9dccb6de12a76cb9aa472e06208486909d31e088`.
- [x] Start a no-commit merge of #45 and resolve README while retaining the current 55 skills.
- [x] Run the baseline suite and record actual failures.
- [x] Validate reviewer findings against pinned source and reproductions.

### Task 2: Repair directory loading and registration

Files: `index.js`, `package.json`, `tests/package-surface.test.mjs`, `.opencode/plugins/opencode-power-pack.js`, `.opencode/lib/agent-config.js`, `tests/plugin-registration.test.mjs`.

- [x] Add a package-surface regression asserting the published root `index.js` and its dual-compatible default export; observe failure.
- [x] Export the existing plugin from root `index.js` and include it in published files.
- [x] Add and reproduce regressions for any confirmed registration defects before implementing their fixes.
- [x] Run package and plugin tests, preserving user definitions and independent permissions.

### Task 3: Verify actual OpenCode 2 and repair contributor tooling

Files: `scripts/opencode-smoke.mjs`, `.github/workflows/opencode-smoke.yml`, `scripts/behavioral-evals.mjs`, `tests/opencode-smoke.test.mjs`, `tests/behavioral-evals.test.mjs`, `tests/fixtures/fake-opencode.mjs`.

- [x] Test the actual package root with V2 smoke, without wrapping the entrypoint under test.
- [x] Assert effective specialist permission rules with permissive global settings.
- [x] Add regression tests for confirmed model/API failures, then implement minimal fixes.
- [x] Keep V1 and V2 smoke jobs, adding current V2 2.0.32 and minimum workflow permissions.
- [x] Run smoke on 1.18.7, 2.0.14, and 2.0.32.

### Task 4: Documentation, complete verification, and approval handoff

Files: `README.md`, `docs/sandbox-compatibility.md`, `evals/behavioral/README.md`, this plan.

- [x] Document tested versions and V2 contributor-tooling requirements accurately.
- [x] Run `npm test`, package checks, and inspect `git diff --check` and final changed paths.
- [x] Record results and any material limits; retain original PR history in the pending merge.
- [x] Prepare the exact proposed commit message and approval handoff before committing or any remote action.

## Execution notes

- PR #45 provides the more complete migration but conflicts with current main in README. PR #52 is narrower and supplies a useful root entrypoint, but leaves the helper in the plugin scan directory and does not port CI/evals.
- The user explicitly requested planning followed by execution. No additional planning approval gate applies; repository and developer commit/remote approval requirements remain in force.
- Node tests create temporary fixtures. A project-local TMPDIR keeps their writes inside the repository.
- Ruling: use a deny-only V2 permission hook and leave host agent permission defaults intact. The host applies global rules and user agent definitions after external transforms on both 2.0.14 and 2.0.32. A hook protects bundled roles after global allows, while an identity check preserves user replacements with a different system or primary mode.
- Ruling: wait for native final catalogs before smoke assertions. The health endpoint and first catalog request can return before plugin registration completes. A setup-time companion plugin hides the later global-permission overwrite.
- Confirmed fixes beyond #45: failed/interrupted turns cannot produce passing behavioral evidence; optional model variants are parsed correctly; Git update/remove instructions use the exact configured spec; local Git installs require update/reinstall after pulling.
- Native V2 database credentials are intentionally not copied into evaluation runtimes. Live runs are documented to use provider environment credentials; no credential-backed model run is part of verification.
- Baseline parallel tests with project-local temporary directories exposed sandbox fixture interference. Serial execution isolated one additional pre-existing fixture assumption: its workspace resolved to the outer checkout. Initializing that fixture as its own Git repository reproduces the intended protected-path rejection without requiring a native sandbox backend. Full-suite verification uses `npm test -- --test-concurrency=1`.
- Independent final review found one transient socket retry regression in catalog polling. A new HTTP regression failed before the fix and passed after restoring five retries. The revised review reported no remaining confirmed Important or Critical issues.

## Final verification and handoff

- `npm test -- --test-concurrency=1`: 418 tests, 417 passed, zero failures, one optional native sandbox integration skipped. TMPDIR and npm cache were project-local.
- `npm run smoke:opencode`: passed on real OpenCode 1.18.7, 2.0.14, and 2.0.32. Each discovered 55 skills and three agents; V2 also passed effective permission checks under global allow rules.
- `git diff --cached --check`: clean; no unresolved merge paths. The historical untracked plan remains untouched.
- No credential-backed live model evaluation was run. The package version remains 0.5.0; release publishing is outside this task.
- Integration branch: `feat/opencode-v2-update`, based on main `9dccb6de12a76cb9aa472e06208486909d31e088`, with a pending merge retaining the five commits of PR #45.
- Approved exact commit message: `Update the skills for OpenCode 2 and keep OpenCode 1 support`.
- The user approved the final English commit message and the integration workflow. Commit, push, PR creation, and PR merge are the remaining execution steps, with merge conditional on passing CI.
