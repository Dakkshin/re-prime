# Todo: re-prime open items

Plan: `tasks/open-items-plan.md`. Not a numbered phase. Do not clobber
`tasks/todo.md` (Phase 2).

## G1: Configurable image-TTL payback window
- [x] G1.1 `ImageTtlOptions.paybackTurns` + `DEFAULT_IMAGE_TTL.paybackTurns = 2`
- [x] G1.2 `PRIME_AGENT_IMAGE_TTL_PAYBACK_TURNS` (env > settings > default), warn+fallback
- [x] G1.3 `context-budget.test.ts` precedence rows
- [x] G1.4 README flag table + caveat line

## G2: Janitor superseded successful dumps
- [x] G2.1 `successDumpMinBytes` default 8192 in `CONTEXT_JANITOR_DEFAULTS`
- [x] G2.2 deterministic signature-supersession in `planContextJanitor`
- [x] G2.3 `PRIME_AGENT_CONTEXT_JANITOR_SUCCESS_BYTES` + settings + `_applyContextJanitor`
- [x] G2.4 `context-janitor.test.ts`: compress / defer / flag-off / re-run only

## G3: /context per-turn stats
- [x] G3.1 bounded history helper in `context-stats.ts` (+ test)
- [x] G3.2 `ContextTreeNode.recentStats?`; root populated in `getContextTree`
- [x] G3.3 render recent-turns table in `context-tree-format.ts`
- [x] G3.4 bump `DAEMON_SCHEMA_REVISION` to 30 + `DAEMON_SCHEMA_ID` + comment

## G4: Genuine recorded trace
- [x] G4.1 `benchmarks/lib/convert-session.ts` (v3 session -> trace + redaction)
- [x] G4.2 commit `benchmarks/fixtures/recorded-session-trace.jsonl`
- [x] G4.3 register `recorded` workload; `--check` exit 0
- [x] G4.4 README workload list

## G5: Docs and hero
- [x] G5.1 `docs/DIVERGENCE.md`
- [x] G5.2 `docs/REPRODUCING.md`
- [x] G5.3 rebrand `CONTRIBUTING.md`, `SECURITY.md`
- [x] G5.4 README hero -> Unicode banner; refresh `todos`

## Checkpoint Complete
- [x] `npm run check` exit 0
- [x] `npm run check:test-policy` exit 0
- [x] `npx tsx benchmarks/run-replay.ts --repeat 3 --check` exit 0
- [x] Every new/modified test file run directly
- [x] `packages/coding-agent/.changes/re-prime-open-items.md` fragment
- [x] Only session-touched files staged; FF-main; pushed to `re-prime`
