# Divergence: re-prime vs upstream prime-agent

re-prime is a fork of [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent)
(base `976ea10`). It is not a rewrite and not a replacement. This file lists
exactly what differs so an upstream rebase stays mechanical.

Everything here is additive and opt-in. With no flags set, the provider payload
is byte-identical to upstream: the transforms are passthroughs and the new
modules are never called.

## new modules

| module | purpose |
|---|---|
| `benchmarks/` (root) | deterministic replay harness: billing, workloads, CLI |
| `packages/coding-agent/src/core/tool-output-cap.ts` | head/tail cap with a scratchpad pointer |
| `packages/coding-agent/src/core/image-ttl.ts` | stale-image eviction + payback gate |
| `packages/coding-agent/src/core/context-janitor.ts` | superseded-trajectory tombstones |
| `packages/coding-agent/src/core/context-budget.ts` | flag/settings/env resolution |
| `packages/coding-agent/src/core/context-stats.ts` | per-turn token/byte telemetry |
| `packages/coding-agent/src/core/rlm-child-deadline.ts` | idle deadline for RLM children |
| `packages/coding-agent/src/core/jev-spawn-gate.ts` | classifier gate on `rlm.spawn` |

## touched upstream files

- `agent-session.ts` — single-line call sites only: cap in `afterToolCall`, TTL
  and janitor in `transformContext`, deadline arm/reset/clear, spawn gate after
  the depth check, stats snapshot on `turn_end`, `recentStats` on
  `getContextTree`.
- `context-tree.ts` / `context-tree-format.ts` — optional `recentStats` field and
  its `/context` section.
- `context-budget.ts` — new env keys (see the README flag table).
- `daemon-protocol.ts` — schema revision bump for the optional `recentStats`
  field (backward-compatible; no capability gate).

No upstream default behavior is changed. No upstream message is dropped by any
transform: the cap and TTL change the provider payload, not the durable
transcript, and the janitor replaces content in place.

## deliberate non-goals

- **No provider calls in the harness.** The replay models a bill; it never makes
  one. A prefix break is billed conservatively as a full-turn rewrite.
- **No prose generation.** The janitor composes tombstones from structured
  facts; the Jev endpoint is a decisions API and cannot author text.
- **No new runtime dependencies.**

## rebasing

The upstream files above are the only merge surface. Because the call sites are
one line each and all logic lives in the new modules, a rebase is normally a
matter of re-applying those lines. If upstream restructures `transformContext`
or `afterToolCall`, re-anchor the hooks there and the modules are unchanged.
