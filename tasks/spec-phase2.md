# Spec: Phase 2 - Zero-Bloat RLM Execution Engine

Status: Approved. Package: `packages/coding-agent` (+ root `benchmarks/`, root `tsconfig.json`).
Related: `tasks/spec-phase1.md`, `tasks/plan.md`, `tasks/todo.md`.

## Objective

Close the remaining failure modes of recursive autonomous execution: unbounded
recursive spawning, unmeasured steady-state token spend, and orphaned children.
Phase 1 shipped the deterministic context wins (tool-output cap, image TTL).
Phase 2 ships the measurement harness that proves them, plus the three
remaining control gates.

## Already done (not rebuilt)

| Workstream | Evidence |
|---|---|
| WS1 tool-output cap | `src/core/tool-output-cap.ts`, wired at `agent-session.ts:1916` |
| WS2 image TTL | `src/core/image-ttl.ts`, composed at `agent-session.ts:1964` |
| WS3.1 hard depth cap | `agent-session.ts:12054`, `RLM_MAX_DEPTH` (default 2) |
| WS5.1 cascade teardown | `disposeAsync`/`dispose` (`agent-session.ts:4882-4995`), orphan-process journal |

## Spec corrections (binding)

1. **Test policy.** The policy is `scripts/check-test-policy.mjs`, not `scripts/test-policy.ts`. It walks only `packages/` and `prime-agent-runtime/test` (line 293). Root `benchmarks/` is invisible to it; no policy edit is made. Biome's `files.includes` also excludes root `benchmarks/`.
2. **Depth env name.** Keep `RLM_MAX_DEPTH`. `PRIME_AGENT_MAX_DEPTH` does not exist and is not introduced; the existing name is documented, tested, and drives `/rlm-max-depth`.
3. **Tombstones are deterministic.** The Jev OpenRouter endpoint is a non-generative decisions API (`jev-openrouter.ts:166`). It cannot author prose. The janitor composes tombstones from structured facts (tool name, error category, exit status, superseding turn).
4. **Scratchpad stays in the session dir.** `~/.prime/agent/session-artifacts/<session>/scratch/` per the frozen Phase-1 interface. `/tmp` is used only by throwaway benchmarks.

## Scope

- **WS0 (Phase A):** deterministic replay harness at root `benchmarks/`.
- **WS5.2 (Phase B):** opt-in child idle deadline (dead-man's switch).
- **WS3.2 (Phase C):** Jev spawn admission gate.
- **WS4 (Phase D):** phase-transition context janitor.
- **WS6 (Phase E):** verification and changelog.

Out of scope: changing default (flag-off) behavior; dropping messages (tombstone/compress only); prose generation; editing `packages/ai/src/models.generated.ts`.

## Acceptance criteria

1. Flags-off replay telemetry is byte-identical across repeated runs.
2. Flags-on: `toolResultBytes_capped <= 0.20 * toolResultBytes_raw`.
3. Flags-on: `cacheWrite_capped <= cacheWrite_raw` (zero cache-invalidation tax).
4. Depth never exceeds `RLM_MAX_DEPTH` (existing, regression-covered).
5. Spawn gate (enabled): trivial spawn rejected with `DELEGATION_REJECTED`, complex accepted, classifier error fails open.
6. Child idle deadline (enabled): a waiting child past the deadline is aborted with `RLM_CHILD_ORPHAN_TIMEOUT`; executing children are exempt; disabled default is inert.
7. Janitor (enabled): at most one prune per window (`>= 40000` tokens AND `>= 15` turns since last prune); watermark persists across resume; flag-off is passthrough.
8. `npm run check` and `npm run check:test-policy` clean.

## Flags (all default off)

| Env var | Default | Meaning |
|---|---|---|
| `PRIME_AGENT_TOOL_OUTPUT_CAP` | `false` | Phase 1, existing |
| `PRIME_AGENT_IMAGE_TTL` | `false` | Phase 1, existing |
| `PRIME_AGENT_RLM_CHILD_IDLE_TIMEOUT_MS` | `0` (off) | WS5.2 deadline |
| `PRIME_AGENT_JEV_SPAWN_GATE` | `false` | WS3.2 gate |
| `PRIME_AGENT_CONTEXT_JANITOR` | `false` | WS4 janitor |
| `PRIME_AGENT_CONTEXT_JANITOR_TOKENS` | `40000` | WS4 token threshold |
| `PRIME_AGENT_CONTEXT_JANITOR_TURNS` | `15` | WS4 turn window |

## Test policy compliance

- New tests live in the existing module suites; assertions are table-driven (`it.each`).
- A change may not add more test lines than source lines.
- No live provider APIs, credentials, `.skip`, retries, or fixed sleeps as readiness signals.
- Run focused tests from the package root:
  `npx tsx ../../node_modules/vitest/dist/cli.js --run test/<file>.test.ts`
