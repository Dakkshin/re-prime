# Spec: Phase 1 - Deterministic Context Wins

Status: Draft (awaiting human approval)
Package: `packages/coding-agent` (no `packages/agent` API changes this phase)
Related: `tasks/interfaces-phase1.md`, `tasks/plan.md`, `tasks/todo.md`

## Objective

Cut steady-state token spend on long autonomous runs by reducing what **enters** context each turn and by evicting stale image payloads, with **zero** prefix-cache invalidation.

The user is a Prime Agent operator running long, tool-heavy autonomous sessions. The observed failure mode (75.5M tokens, ~99% of it `cacheRead`) is driven by context growth, not by turn count. This phase attacks context growth deterministically; it ships no classifier behavior.

Success is a measurably lower token bill on the same task, with a provider payload that is byte-identical to today when the feature flags are unset.

## Scope

In scope (Phase 1): WS0 instrumentation + key resolver, WS1 universal tool-output cap, WS2 image TTL, WS6 verification + changelog.

Out of scope (Phase 2): WS3 spawn gate, WS4 Jev context janitor, WS5 fact grounding. Spawn default `RLM_MAX_DEPTH` stays `2`; the flag-to-1 override and Jev `DELEGATE_SANDBOX` gate are Phase 2.

## Tech Stack

- TypeScript (ESM), Node >= 20
- `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, TypeBox
- Vitest for tests
- No new runtime dependencies

## Commands

```
Check (required before commit):   npm run check
Test policy (required):           npm run check:test-policy
Focused test (from package root):
  npx tsx ../../node_modules/vitest/dist/cli.js --run test/<file>.test.ts
Suite tests use test/suite/harness.ts + the faux provider (never live APIs).
Changelog fragments:              packages/coding-agent/.changes/<slug>.md
Forbidden:                        npm run dev | npm run build | npm test
```

## Project Structure

```
packages/coding-agent/src/core/
  agent-session.ts        afterToolCall wiring (cap), hook install ~1859
  sdk.ts                  transformContext composition (image TTL) ~327
  context-stats.ts        NEW - per-turn telemetry
  tool-output-cap.ts      NEW - cap + scratchpad pointer logic
  image-ttl.ts            NEW - image eviction view transform
  jev-openrouter.ts       key resolver (additive)
  jev-router.ts           resolver injection (additive)
  tools/truncate.ts       REUSED - truncateHead / truncateTail
  settings-manager.ts     config resolution (cap, ttl)
packages/coding-agent/test/<module>.test.ts        unit tests
packages/coding-agent/test/suite/                  integration (faux provider)
packages/coding-agent/.changes/<slug>.md           changelog fragments
tasks/                                             this spec + plan + todo
```

## Code Style

Composition, not replacement. `afterToolCall` currently returns early when no extension handlers exist (agent-session.ts:1883); restructure so the cap always runs, then extension overrides merge. Pure functions for logic; I/O isolated and injected at the call site.

```ts
export interface CapToolOutputInput {
  content: (TextContent | ImageContent)[];
  existingFullOutputPath?: string;
  options: ToolOutputCapOptions;
  writeScratchpad: (text: string) => string;
}

export function capToolOutput(input: CapToolOutputInput): CappedToolOutput {
  // fail open: any error returns the original content, capped: false
}
```

Rules: no `any`; no inline imports; no unnecessary comments.

## Testing Strategy

- Framework: Vitest. One test file per source module; repeated cases in `it.each` tables.
- Unit tests: pure cap logic, TTL transform, config parsing, key resolver (fake `AuthStorage`).
- Integration: `test/suite/harness.ts` + faux provider. No live APIs, credentials, paid tokens, `.skip`, or retries.
- Every test must fail when the covered behavior is reverted (prove by stubbing).
- Tests are unconditional and self-contained; bind port 0, unique temp paths, restore env/cwd, close resources in `finally`.
- A change may not add more test lines than source lines.
- Regressions carry the issue number and live in the affected module's suite.
- `npm run check` and `npm run check:test-policy` must be clean.

## Boundaries

- Always: transform only above threshold; guarantee at least one content part survives; keep raw bytes retrievable via the pointer; non-destructive `transformContext`.
- Ask first: changing the global `afterToolCall` contract; adding settings/env keys; anything that alters default (unflagged) behavior.
- Never: drop messages in Phase 1 (tombstone/compress only); mutate `agent.state.messages` from `transformContext`; flip the `RLM_MAX_DEPTH` default; commit secrets or a raw API key; edit `packages/ai/src/models.generated.ts`; bypass test policy; use `--no-verify`.

## Success Criteria

1. The same replay shows lower total tokens and lower `cacheRead` than pre-Phase-1.
2. No `cacheWrite` increase attributable to Phase 1 (proves no cache-invalidation tax).
3. Every tool result over threshold becomes head+tail plus a working scratchpad path (bash, ipython, MCP).
4. No image older than `ttlTurns` is re-sent as bytes; the durable transcript retains it.
5. Flags off produces a byte-identical provider payload to today.
6. `npm run check` and `npm run check:test-policy` are clean.

## Assumptions (correct before implementation)

1. Phase 1 touches `packages/coding-agent` only; `packages/agent` stays unchanged.
2. The cap lives in `afterToolCall` (host has fs/session access), not in the agent loop.
3. `transformContext` remains a non-destructive view; the durable session keeps every byte.
4. All Phase 1 behavior is flag-gated OFF by default.
5. Credentials resolve from `~/.prime/agent/auth.json` first, env second; no secret in a tracked file.
6. Scratchpad lives under the agent dir (`~/.prime/agent/session-artifacts/<session>/scratch/`), not `/tmp`.
7. Cap default is conservative (200 lines / 16384 bytes, head ratio 0.6), tightened after baseline data.
8. Baseline is a repeatable AssaultCube replay (frozen transcript if one exists, else scripted).
9. No new runtime dependency; reuse `truncate.ts` and existing settings/telemetry plumbing.

## Open Questions

1. Baseline source - is there a saved AssaultCube session/transcript to replay, or script fresh? (Blocks WS0.2.)
2. Telemetry surface - log line only, or also a `/context` command?
3. Cap defaults - accept 200 lines / 16384 bytes, or go aggressive (40 lines / ~1500 tokens) now?
4. Cap override - should the cap be unoverridable by extension `tool_result` hooks? (Recommendation: yes, cap runs last.)
