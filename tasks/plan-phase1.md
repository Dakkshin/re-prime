# Implementation Plan: Phase 1 - Deterministic Context Wins

See `tasks/spec-phase1.md` for the spec and `tasks/interfaces-phase1.md` for frozen contracts.

## Overview

Reduce steady-state token spend on long autonomous runs by capping what enters context per turn (tool outputs) and evicting stale image payloads, with zero prefix-cache invalidation. No classifier behavior ships. All behavior is flag-gated OFF; a run with flags unset is byte-identical to today.

## Architecture Decisions

- Cap at `afterToolCall` (`agent-session.ts:1883`), not the loop. `packages/agent` has no fs dependency and stays host-agnostic; scratchpad I/O belongs to the host.
- `transformContext` stays a non-destructive view. It rewrites only the provider payload; the durable session and `agent.state.messages` keep every byte. Eviction re-applies on reload.
- Image TTL triggers one-time per image, never on the active window. This bounds cache invalidation to a single already-old edit point instead of churning the live prefix.
- Credentials resolve from `AuthStorage` (`openrouter`) -> env -> `undefined`. The key already lives in `~/.prime/agent/auth.json` (0600); `jev-openrouter.ts:159` reading env-only is the actual defect. No secret goes in a tracked file.
- Fail-open error semantics everywhere, matching Jev's existing contract.
- Flags default off; passthrough is tested. Guards non-Jev users against silent behavior drift.
- Conservative cap default (200 lines / 16384 bytes), tightened on baseline data.

## Dependency Graph

```
truncate.ts (existing) --------+
                               +--> T4 cap fn --> T5 cap wiring --> T6 cap config
T1 context-stats --------------+
                               +--> T3 baseline replay
AuthStorage (existing) --------> T2 key resolver
settings-manager (existing) ---> T6 / T8
T1 ----------------------------> T8 TTL wiring
T7 TTL fn ---------------------> T8 TTL wiring
T5, T8 ------------------------> T9 checks --> T10 changelog
```

Build bottom-up: pure logic -> wiring -> config -> verify. Cap and TTL are independent vertical slices. `T6` and `T8` both touch `settings-manager.ts`; sequence them.

## Task List

### Phase 1: Foundation
- [ ] T1: Per-turn context-stats record (WS0.1)
- [ ] T2: Jev key resolver (WS0.3)
- [ ] T3: Repeatable baseline replay (WS0.2)

### Checkpoint: Foundation
- [ ] T1-T3 tests pass; `npm run check` clean; baseline numbers captured.

### Phase 2: Tool-Output Cap (vertical slice)
- [ ] T4: `capToolOutput` + scratchpad writer (WS1.1)
- [ ] T5: Wire cap into `afterToolCall` (WS1.2)
- [ ] T6: Cap config (WS1.3)

### Checkpoint: Cap
- [ ] Cap tests pass; baseline replay shows lower `toolResultBytes`; flag-off payload unchanged; review before TTL.

### Phase 3: Image TTL (vertical slice)
- [ ] T7: TTL transform (WS2.1)
- [ ] T8: Compose into `transformContext` + config (WS2.2)

### Checkpoint: TTL
- [ ] TTL tests pass; baseline replay shows lower `imageBytes`; `cacheWrite` not elevated vs. baseline; review before ship.

### Phase 4: Verify and Ship
- [ ] T9: Full verification (WS6.1)
- [ ] T10: Changelog fragments (WS6.2)

### Checkpoint: Complete
- [ ] All acceptance criteria met; baseline shows lower total + `cacheRead`, no `cacheWrite` regression; ready for review.

## Verification Plan

- Per task: focused test file passes; `npm run check` clean for touched packages.
- After T5 and after T8: run the T3 baseline replay and diff against the Foundation capture.
- Before ship: `npm run check:test-policy`; confirm flag-off provider payload is byte-identical.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Cap separates toolCall from toolResult or empties a message | High | Guarantee >= 1 content part; suite test asserts pairing |
| Scratchpad grows unbounded on disk | Med | Session-scoped dir; cap file count/size; cleanup on session end |
| `transformContext` mutates shared arrays | High | Operate on copies; non-destructive; passthrough test |
| TTL itself invalidates cache | Med | One-time per old image; WS0.1 confirms `cacheWrite` flat |
| Flag defaults on by accident | Med | Passthrough test fails if flag-off output differs |
| Key resolver logs/inlines the secret | High | Never log; injected resolver; unit test |
| `afterToolCall` restructure breaks extension hooks | Med | Suite tests for extension `tool_result` merge |
| Baseline not reproducible | Med | Freeze transcript; document invocation |
| Test-policy violation in new tests | Low | `npm run check:test-policy` in T9 |

## Parallelization

- Safe in parallel: T2 and T3 alongside T1; T4 and T7 alongside each other.
- Sequential: T5 before T6; T7 before T8; T6 and T8 (shared `settings-manager.ts`).
- Coordinate: any change to `afterToolCall` ordering (shared contract).

## Open Questions

1. Baseline source - saved AssaultCube session/transcript to replay, or script fresh?
2. Telemetry surface - log line only, or a `/context` command?
3. Cap defaults - 200 lines / 16384 bytes, or aggressive (40 lines / ~1500 tokens)?
4. Cap override - unoverridable by extension hooks? (Recommendation: yes.)

## Verification (before implementation)

- [x] Every task has acceptance criteria
- [x] Every task has a verification step
- [x] Dependencies identified and ordered
- [x] No task exceeds ~5 files
- [x] Checkpoints after each phase
- [ ] Human has reviewed and approved the plan
- [ ] Open Questions 1-4 answered
