# Reproducing the numbers

The README quotes replay output. This is how to reproduce it, and why it is
deterministic.

## run it

```sh
git clone https://github.com/Dakkshin/re-prime
cd re-prime
npm ci

npm run bench:replay                     # all workloads, human summary
npm run bench:replay -- --check          # exit 1 if a gate regresses
npm run bench:replay -- --repeat 3       # determinism check
npm run bench:replay -- --json           # machine-readable telemetry
npm run bench:replay -- --workload heavy # one workload by name
npm run bench:replay -- --workload ./my-session-trace.jsonl
```

The README's table is the `heavy` workload. `--repeat 3 --check` exits 0 with
`determinism: 3 runs byte-identical`.

## why it is deterministic

- **No provider.** Every turn is priced against a simulated prefix cache
  (`benchmarks/lib/billing.ts`): an intact prefix bills `cacheRead`, a rewritten
  prefix bills `cacheWrite` for the whole turn. No network, no API key.
- **No clock.** Timestamps are a fixed base constant; telemetry carries no
  wall-clock field.
- **No RNG.** The synthetic workloads build payloads with arithmetic filler
  (`textDump`, `base64Image`); the trace fixture is a fixed file.
- **Sorted keys.** `stableStringify` sorts object keys, so `--json` output is
  byte-stable across runs and machines.

## the workloads

| name | source | what it exercises |
|---|---|---|
| `heavy` | synthetic | one 100 KB dump + a 200 KB screenshot, 8 turns |
| `heavy-long` | synthetic | `heavy` plus 12 trailing reads, so the TTL can amortize |
| `assaultcube` | trace fixture | a scripted failure trajectory (many small failures, then a success) |
| `recorded` | trace fixture | a real recorded session, converted and redacted |

`assaultcube` and `recorded` are loaded by `benchmarks/lib/workloads.ts`; any
JSONL in the trace schema can be passed with `--workload <path>`.

## the trace schema

One JSON object per line, one line per turn:

```json
{"turn":0,"add":[{"role":"user","text":"..."}]}
{"turn":1,"add":[
  {"role":"assistant","text":"...","toolCall":{"name":"bash","arguments":{"command":"ls"}}},
  {"role":"toolResult","toolName":"bash","toolCallId":"t1","text":"...","isError":true}]}
```

An entry carrying `content` is treated as a raw `AgentMessage` and passed
through unchanged, so a recorded session can be replayed directly.

## converting a recorded session

Prime Agent persists sessions as v3 JSONL under
`~/.prime/agent/sessions/<id>.jsonl`. Convert one to the trace schema with:

```sh
npx tsx benchmarks/lib/convert-session.ts ~/.prime/agent/sessions/<id>.jsonl \
  --out benchmarks/fixtures/my-trace.jsonl
```

The converter drops non-message entries, replaces image pixel data with a 1x1
placeholder (the token cost is flat, so the eviction plan is preserved), and
redacts home directories, the local username, and common credential shapes.
`--check` re-runs the redaction over every committed fixture and fails if any
text would still change, so an unredacted fixture cannot be committed silently.

## the gates

`--check` fails on a real regression, not on a cosmetic one:

| gate | condition |
|---|---|
| tool-result reduction | capped text bytes ≤ 0.20 × raw, when a result exceeds the **byte** cap |
| cache-write tax | `cacheWrite` never increases for cap, TTL, or combined |
| billed tokens | `billedTokens` never increases |
| bounded breaks | prefix breaks ≤ eviction events |

The reduction gate is keyed to byte-cap opportunities: a workload of many small
results (like `recorded`) has no line-cap-only opportunity to pay off, so it
reports `n/a` rather than a misleading `FAIL`.

## what the numbers do and do not mean

The harness compares variants deterministically. It does **not** predict an
invoice: a prefix break is billed as a full-turn rewrite, and real provider
pricing differs. Use it to rank configurations, not to forecast cost.
