# Todo: Phase 3

Plan: `tasks/plan-phase3.md`. Execute in order; do not advance past a checkpoint
until it passes. Do not clobber `tasks/todo.md` (Phase 2).

## G1: Configurable image-TTL payback window
- [ ] G1.1 `ImageTtlOptions.paybackTurns` + `DEFAULT_IMAGE_TTL.paybackTurns = 2`
- [ ] G1.2 `PRIME_AGENT_IMAGE_TTL_PAYBACK_TURNS` (env > settings > default), warn+fallback
- [ ] G1.3 `context-budget.test.ts` precedence rows
- [ ] G1.4 README flag table + caveat line

## G2: Janitor superseded successful dumps
- [ ] G2.1 `successDumpMinBytes` default 8192 in `CONTEXT_JANITOR_DEFAULTS`
- [ ] G2.2 deterministic signature-supersession in `planContextJanitor`
- [ ] G2.3 `PRIME_AGENT_CONTEXT_JANITOR_SUCCESS_BYTES` + settings + `_applyContextJanitor`
- [ ] G2.4 `context-janitor.test.ts`: compress / defer / flag-off / re-run only

## G3: /context per-turn stats
- [ ] G3.1 bounded history helper in `context-stats.ts` (+ test)
- [ ] G3.2 `ContextTreeNode.recentStats?`; root populated in `getContextTree`
- [ ] G3.3 render recent-turns table in `context-tree-format.ts`
- [ ] G3.4 bump `DAEMON_SCHEMA_REVISION` to 30 + `DAEMON_SCHEMA_ID` + comment

## G4: Genuine recorded trace
- [ ] G4.1 `benchmarks/lib/convert-session.ts` (v3 session -> trace + redaction)
- [ ] G4.2 commit `benchmarks/fixtures/recorded-session-trace.jsonl`
- [ ] G4.3 register `recorded` workload; `--check` exit 0
- [ ] G4.4 README workload list

## G5: Docs and hero
- [ ] G5.1 `docs/DIVERGENCE.md`
- [ ] G5.2 `docs/REPRODUCING.md`
- [ ] G5.3 rebrand `CONTRIBUTING.md`, `SECURITY.md`
- [ ] G5.4 README hero -> Unicode banner; refresh `todos`

## Checkpoint Complete
- [ ] `npm run check` exit 0
- [ ] `npm run check:test-policy` exit 0
- [ ] `npx tsx benchmarks/run-replay.ts --repeat 3 --check` exit 0
- [ ] Every new/modified test file run directly
- [ ] `packages/coding-agent/.changes/phase3-*.md` fragments
- [ ] Only session-touched files staged; FF-main; pushed to `re-prime`
