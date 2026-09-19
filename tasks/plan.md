# Implementation Plan: Phase 2 - Zero-Bloat RLM Execution Engine

Spec: `tasks/spec-phase2.md`. Supersedes `tasks/plan-phase1.md` (shipped).

## Overview

Four vertical slices on top of the shipped Phase-1 context budget: a
deterministic replay harness that measures it (WS0), an opt-in child idle
deadline (WS5.2), a Jev spawn admission gate (WS3.2), and a phase-transition
context janitor (WS4). Every behavior is flag-gated OFF; flag-off runs are
byte-identical to today.

## Architecture decisions

- **Harness lives at root `benchmarks/`.** Outside the test-policy walk roots
  and biome `files.includes`; no policy weakening. Typechecked by adding
  `benchmarks/**/*` to root `tsconfig.json` include.
- **Billing is simulated, not billed.** The replay maintains a SHA256 prefix
  hash; matching prefix bills `cacheRead = prefixTokens`, a break bills
  `cacheWrite = totalTokens`. Deterministic, no provider, no clock, no RNG.
- **Janitor composes, never generates.** Jev classifies; the tombstone text is
  a deterministic template over structured facts.
- **Deadline is a timer in the parent run tracker**, reset on
  `touchRlmChildActivity`, exempt while `activity.kind === "executing"`, and
  cleared on settle. Mirrors `pendingChildUsageTimer` (unref'd).
- **Spawn gate is a classifier wrapper**, reusing
  `createOpenRouterJevClassifier` with three choice names; fail-open, hard throw
  only when enabled.
- **Surgical `agent-session.ts` edits.** New logic in new modules; the 14k-line
  file gets single-line call sites only, to avoid parallel-agent conflicts.

## Dependency graph

```
A1 billing ──> A3 replay ──> A4 CLI ──> Checkpoint A ──> E2 baseline
A2 workloads ┘
B1 deadline config ──> B2 timer wiring ──> B3 tests
C1 gate module ──> C2 spawn wiring ──> C3 tests
D1 janitor planner ──> D2 transform wiring ──> D3 config ──> D4 tests
B, C, D ──> E1 check/test-policy ──> E3 changelog
```

## Task list

### Phase A: Measurement harness (WS0)
- [x] A1 `benchmarks/lib/billing.ts` - deterministic counter + prefix-hash cache
- [x] A2 `benchmarks/fixtures/*.jsonl` + `benchmarks/lib/workloads.ts` loader
- [x] A3 `benchmarks/replay.ts` - flags off/on, stable JSON telemetry
- [x] A4 `benchmarks/run-replay.ts` CLI + `bench:replay` + tsconfig include

### Checkpoint A
- [x] Flags-off telemetry byte-identical across 3 runs
- [x] `toolResultBytes_capped <= 0.20 * raw`
- [x] `cacheWrite_capped <= cacheWrite_raw`

### Phase B: Child dead-man's switch (WS5.2)
- [x] B1 `PRIME_AGENT_RLM_CHILD_IDLE_TIMEOUT_MS` config + resolver
- [x] B2 arm/reset/clear deadline timer; abort + `RLM_CHILD_ORPHAN_TIMEOUT`
- [x] B3 table-driven tests in `test/agent-session-recursion.test.ts`

### Checkpoint B
- [x] Executing child exempt; waiting child past deadline aborted; flag-off inert
- [x] No leaked timers after settle

### Phase C: Jev spawn gate (WS3.2)
- [x] C1 `src/core/jev-spawn-gate.ts` choice wrapper (fail-open)
- [x] C2 wire into `_startRlmChildRun` after the depth check
- [x] C3 tests with injected classifier

### Checkpoint C
- [x] Trivial rejected, complex accepted, no key = no gate, throw = fail open

### Phase D: Context janitor (WS4)
- [x] D1 `src/core/context-janitor.ts` pure planner + tombstones
- [x] D2 threshold trigger + persistent watermark in `transformContext`
- [x] D3 config + counters into `context-stats.ts`
- [x] D4 tests: one prune per window, flag-off passthrough

### Checkpoint D
- [x] One prune per window; watermark survives resume; cacheWrite flat otherwise

### Phase E: Verify and ship
- [x] E1 `npm run check`, `npm run check:test-policy`, focused suites
- [x] E2 record baseline numbers from `bench:replay`
- [x] E3 changelog fragments

### Phase F: TTL payback gate (post-checkpoint fix)
- [x] F1 Price the break in `image-ttl.ts` (`planImageEviction`, window 2 turns)
- [x] F2 Wire the planner into `agent-session.ts` and the replay; share token accounting
- [x] F3 Harden `--check` with a `ttlOnly.cacheWrite` regression gate

### Checkpoint Complete
- [x] All acceptance criteria in `tasks/spec-phase2.md` met
- [x] Ready for review

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Janitor re-prunes and re-busts cache | High | Persistent watermark + hard turn gate; single-prune test |
| Test LOC parity | Med | `it.each` tables; extend existing suites |
| `agent-session.ts` conflicts | Med | New modules; minimal call sites; stage only touched files |
| Benchmark nondeterminism | High | No clock/RNG in telemetry; sorted keys; fixed fixtures |
| Spawn gate latency | Med | Default off; bounded classifier timeout; fail-open |
| Timer leak in child tracker | Med | `unref()` + clear on settle/dispose; leak test |

## Open questions

All four resolved: tsconfig include approved; hard throw approved; deterministic
tombstones approved; artifacts approved.
