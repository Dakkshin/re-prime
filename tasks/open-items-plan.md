# Implementation Plan: Closing the re-prime open items

Not a numbered phase. Supersedes nothing. Phase 2 plan is `tasks/plan.md`.
Scope comes from the "open items" list in `HANDOVER.md`.

## Overview

Six independent workstreams that finish what Phase 2 left open: make the TTL
payback window configurable, extend the context janitor to superseded
*successful* dumps, surface per-turn context stats in `/context`, check in a
genuine recorded trace, write the divergence/reproduction docs, and switch the
README hero to the Unicode wordmark. All new behavior stays flag-gated OFF; the
existing flag-off payload stays byte-identical.

## Architecture decisions

- **Payback window is config, not a constant.** `ImageTtlOptions` gains
  `paybackTurns`; `context-budget.ts` resolves it from
  `PRIME_AGENT_IMAGE_TTL_PAYBACK_TURNS` > settings > default `2`.
- **"Superseded" means a later call with the same signature.** A successful
  tool result is a candidate only when it is large (>= 8 KiB default) and
  before the protected tail. It is compressed when a *later* tool result shares
  its call signature (tool name + stable-serialized assistant arguments). This
  is deterministic and conservative: an exact re-run is the only evidence that
  an older successful dump has been superseded.
- **Per-turn stats travel as an optional `ContextTreeNode.recentStats`.** Pure
  addition to an existing response; old clients ignore it, a new client
  degrades to no section against an old daemon. Backward-compatible wire
  change, so `DAEMON_SCHEMA_REVISION` is bumped and documented; no capability
  gate is needed.
- **The genuine trace is converted, not hand-written.** A small
  `benchmarks/lib/convert-session.ts` maps a real v3 session JSONL to the trace
  schema and redacts cwd/home paths before the fixture is committed. Fixture is
  deterministic and becomes a default workload.
- **Docs are additive.** New `docs/DIVERGENCE.md` and `docs/REPRODUCING.md`;
  `CONTRIBUTING.md` / `SECURITY.md` are rebranded to re-prime.

## Dependency graph

```
G1 payback config ─────────────────────────────┐
G2 janitor successful dumps ───────────────────┤
G3 /context stats (context-tree + daemon) ─────┼─> G6 verify ─> commit/push
G4 genuine trace (converter + fixture) ────────┤
G5 docs + README hero ─────────────────────────┘
```

G1-G5 touch mostly disjoint files; only `context-budget.ts` is shared by G1/G2
and `README.md` by G1/G5, so they are sequenced.

## Task list

### G1: Configurable payback window
- [x] `ImageTtlOptions.paybackTurns`; `DEFAULT_IMAGE_TTL.paybackTurns = 2`
- [x] `PRIME_AGENT_IMAGE_TTL_PAYBACK_TURNS` env + settings + precedence
- [x] tests: `context-budget.test.ts` precedence table
- [x] README flag table + caveat

### G2: Janitor superseded successful dumps
- [x] `successDumpMinBytes` option + default 8192
- [x] signature-based supersession in `planContextJanitor`
- [x] `PRIME_AGENT_CONTEXT_JANITOR_SUCCESS_BYTES` + settings + wiring
- [x] tests: `context-janitor.test.ts` (approve, defer, flag-off)

### G3: /context per-turn stats
- [x] `context-stats.ts` bounded history helper (+ test)
- [x] `ContextTreeNode.recentStats?` populated on root
- [x] `formatContextTree` renders a recent-turns table
- [x] `DAEMON_SCHEMA_REVISION` 30 + `DAEMON_SCHEMA_ID` + comment

### G4: Genuine recorded trace
- [x] `benchmarks/lib/convert-session.ts` (trace mapping + redaction)
- [x] `benchmarks/fixtures/recorded-session-trace.jsonl` committed
- [x] `recorded` workload registered; `--check` passes
- [x] README workload mention

### G5: Docs and hero
- [x] `docs/DIVERGENCE.md`
- [x] `docs/REPRODUCING.md`
- [x] rebrand `CONTRIBUTING.md`, `SECURITY.md`
- [x] README hero -> Unicode banner; refresh `todos`

### Checkpoint Complete
- [x] `npm run check` exit 0; `npm run check:test-policy` clean
- [x] `npx tsx benchmarks/run-replay.ts --repeat 3 --check` exit 0
- [x] Every new/modified test file run directly and green
- [x] Changelog fragment added for `coding-agent`
- [x] Only files touched this session staged; pushed to `re-prime` via FF-main

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Janitor over-compresses useful output | High | Opt-in, size threshold, exact-signature supersession only, messages never dropped |
| Daemon wire change | Med | Optional field only; schema revision bumped; UI degrades when absent |
| Committing real user data | High | Converter redacts cwd/home/secrets; `--check` re-runs redaction over every fixture |
| Test LOC parity | Med | Extend existing `it.each` suites; keep assertions tight |
| `agent-session.ts` parallel edits | Med | Single-line call sites only; new logic in new modules |
| Bench determinism with new workload | High | No clock/RNG in fixtures; redaction is deterministic |

## Open questions

Resolved in chat: scope = all open items; hero = Unicode `█`; trace = convert
and redact a local session.
