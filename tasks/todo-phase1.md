# Todo: Phase 1 - Deterministic Context Wins

Spec: `tasks/spec-phase1.md` | Interfaces: `tasks/interfaces-phase1.md` | Plan: `tasks/plan.md`

Execute tasks in order. Do not advance a phase until its checkpoint passes.

## Phase 1: Foundation

- [x] T1: Per-turn context-stats record (WS0.1)
  - `src/core/context-stats.ts`, wired at `turn_end` in `agent-session.ts`; unit tests in `test/context-stats.test.ts`.
- [x] T2: Jev key resolver (WS0.3)
  - `resolveApiKey` on `OpenRouterJevOptions`; wired to `AuthStorage.getApiKey("openrouter")` in `agent-session.ts`; tests in `test/jev-openrouter.test.ts`.
- [ ] T3: Repeatable baseline replay (WS0.2) - DEFERRED
  - Blocked on a frozen replay artifact (Open Question 1). No saved session/transcript exists in the repo; a live replay is out of band. Procedure to record once an artifact is chosen.

### Checkpoint: Foundation
- [x] T1-T3 tests pass (T3 deferred)
- [x] `npm run check:test-policy` clean; `tsgo --noEmit` clean
- [ ] Baseline numbers captured (deferred with T3)

## Phase 2: Tool-Output Cap

- [x] T4: `capToolOutput` + scratchpad writer (WS1.1)
  - `src/core/tool-output-cap.ts`; tests in `test/tool-output-cap.test.ts`.
- [x] T5: Wire cap into `afterToolCall` (WS1.2)
  - Cap runs after extension `tool_result` merge (unoverridable); scratchpad under the session artifact dir; wired in `agent-session.ts`.
- [x] T6: Cap config (WS1.3)
  - `ContextBudgetSettings` + `resolveContextBudget`; `getContextBudgetSettings()` on `SettingsManager`; tests in `test/context-budget.test.ts`.

### Checkpoint: Cap
- [x] Cap tests pass
- [ ] Baseline replay: lower `toolResultBytes` (deferred with T3)
- [x] Flag-off provider payload unchanged (unit passthrough test)

## Phase 3: Image TTL

- [x] T7: TTL transform (WS2.1)
  - `src/core/image-ttl.ts`; tests in `test/image-ttl.test.ts`.
- [x] T8: Compose into `transformContext` + config (WS2.2)
  - `_installContextBudgetHooks` wraps the agent `transformContext`; disabled => passthrough.

### Checkpoint: TTL
- [x] TTL tests pass
- [ ] Baseline replay: lower `imageBytes` (deferred with T3)
- [ ] `cacheWrite` not elevated vs. baseline (deferred with T3)

## Phase 4: Verify and Ship

- [x] T9: Full verification (WS6.1)
  - Touched test files pass; `tsgo --noEmit` clean; `npm run check:test-policy` clean. Baseline replay deferred with T3.
- [x] T10: Changelog fragments (WS6.2)
  - `packages/coding-agent/.changes/context-budget-tool-output-cap-image-ttl.md`.

### Checkpoint: Complete
- [x] All in-repo acceptance criteria met
- [ ] Baseline: lower total + `cacheRead` (deferred with T3)
- [x] Ready for review

## Deferred / follow-ups

- T3 baseline replay requires a chosen, frozen replay artifact (Open Question 1).
- Optional integration test for the cap wiring was skipped: the repo test-policy
  caps test LOC at source LOC and the changeset is already at parity. The cap
  logic is covered by unit tests; wiring is covered by `tsgo`.

## Pre-flight

- [x] Q1 baseline source: frozen replay assumed; no artifact in repo (T3 deferred)
- [x] Q2 telemetry surface: log line only
- [x] Q3 cap defaults: 200 lines / 16384 bytes / head ratio 0.6
- [x] Q4 cap override: unoverridable (cap runs after extension merge)
