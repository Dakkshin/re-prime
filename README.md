# re-prime

---

**Update Sep 2026** re-prime is public. It's a fork of Prime Agent that adds a tape measure and four switches for long runs. The one part actually worth reading is [the one idea worth explaining](#the-one-idea-worth-explaining).

---

A fork of [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) (base `976ea10`) that adds a deterministic replay harness and four opt-in controls for what long autonomous runs cost. Prime Agent is already good at running for hours; the trouble is that a prompt cache quietly turns into a bill while it does, and there was no good way to see that or bound it. So this adds a way to measure it offline and four switches to cap the damage. All of them are off by default. That's it.

Prime Agent is itself built on [`pi`](https://github.com/earendil-works/pi) by [@mariozechner](https://github.com/mariozechner) — the packages in here are literally named `@earendil-works/pi-*`, and the `LICENSE` you inherit is his. So this is a fork of a fork, with the MIT notice kept intact. That's the whole lineage.

It is not an official Prime Intellect release, there are no binaries or installers (you build from source), and it is not a security sandbox.

## what's different from prime-agent

- **a deterministic replay harness** (`npm run bench:replay`) that runs transcripts through the real transforms and prices every turn against a simulated prefix cache. No provider, no clock, no RNG, so repeated runs are byte-identical and `--check` can fail a build when a cache-write regression sneaks in.
- **tool-output cap** — oversized tool results keep a head/tail window and the full output goes to the session scratchpad. It runs when the tool result is created, so it never busts the cache.
- **image TTL with a payback gate** — stale screenshots become a text note, but only when the saving actually pays for breaking the cache. Explained below, it's the whole reason this exists.
- **context janitor** — superseded failed tool output becomes a deterministic tombstone, at most once per window (≥40k tokens and ≥15 turns since the last prune). Messages are never dropped.
- **child idle deadline** — a subagent that stopped reporting gets reaped with `RLM_CHILD_ORPHAN_TIMEOUT` instead of hanging around until you notice.
- **Jev routing** — an OpenRouter classifier that can veto a pointless `rlm.spawn`, answer a stop/continue question after tool turns, and drive a pre-turn retry router.
- **per-turn context stats** — cap/eviction/janitor counters get logged alongside the token accounting, so you can reconstruct where the tokens went after the fact.

## the one idea worth explaining

A prompt cache is immutable. Edit a message in the middle of the transcript and every cached token after it is gone; the next request re-processes from that point. So "delete the stale screenshot" isn't cleanup, it's a purchase. You pay a one-time prefix rewrite to save some tokens on every turn afterwards.

Which makes an eviction simple arithmetic — pay `P` now, save `E` per turn — and it only makes sense if there are enough turns left to earn `P` back. Age has nothing to do with it, which is why the obvious "evict after N turns" policy is wrong. Here's the harness showing exactly that on the 8-turn `heavy` workload:

```
  variant     toolTextBytes   residentImageBytes   cacheRead   cacheWrite      billed  breaks  caps  evicted
  raw                 133120             1024000      178953        35784      214737      0    0       0
  cap                  24538             1024000       34547         8639       43186      0    2       0
  ttl                 133120             1024000      178953        35784      214737      0    0       0
  combined             24538              614400       26671        14866       41537      1    2       2
```

Evicting on age alone (`ttl`) is a **loss of 20,880 tokens** against doing nothing: the break rewrites 25,656 tokens of prefix to save 2,376 a turn, and there aren't ten turns left to amortise it, so the gate declines to evict. Turn the cap on first (`combined`) and the prefix is down to 3,127 tokens, so the same eviction repays itself in about 1.3 turns and fires. Same image, same policy, opposite answer — because the accounting changed. That's the entire reason `planImageEviction` exists. I'd call it a heuristic with a clear story, not theory.

## quick start

Node.js 22.8.0 or newer. There's no installer; the upstream script installs upstream Prime Agent, not this.

```sh
git clone https://github.com/Dakkshin/re-prime
cd re-prime
npm ci
./prime-agent.sh          # works from any directory, preserves your cwd
```

Then `/login` on first launch. Keep in mind this runs model-generated Python with your user permissions — it's not a sandbox, so use a disposable checkout or something you have backed up.

```sh
npm run bench:replay               # all workloads, readable summary
npm run bench:replay -- --check    # non-zero exit if a gate regresses
npm run bench:replay -- --repeat 3 # determinism check
```

The docs live under [packages/coding-agent/docs](packages/coding-agent/docs/index.md) and are upstream's, mostly unmodified.

## flags

All off by default. Precedence is env > `contextBudget` settings > default; bad values warn and fall back, nothing throws.

| flag | default | what it does |
|---|---|---|
| `PRIME_AGENT_TOOL_OUTPUT_CAP` | `false` | enable the tool-output cap |
| `PRIME_AGENT_TOOL_OUTPUT_MAX_LINES` / `_MAX_BYTES` / `_HEAD_RATIO` | `200` / `16384` / `0.6` | the cap window |
| `PRIME_AGENT_IMAGE_TTL` | `false` | enable image TTL eviction |
| `PRIME_AGENT_IMAGE_TTL_TURNS` | `2` | turns an image may stay resident before it's eviction-eligible |
| `PRIME_AGENT_CONTEXT_JANITOR` | `false` | enable the context janitor |
| `PRIME_AGENT_CONTEXT_JANITOR_TOKENS` / `_TURNS` | `40000` / `15` | prune thresholds |
| `PRIME_AGENT_RLM_CHILD_IDLE_TIMEOUT_MS` | `0` | idle deadline in ms; `0` disables |
| `PRIME_AGENT_JEV_SPAWN_GATE` | `false` | enable the `rlm.spawn` gate |
| `PRIME_AGENT_JEV_ENABLED` | `false` | enable the pre-turn router |
| `PRIME_AGENT_JEV_STOP` | `false` | enable the stop gate (needs `_JEV_ENABLED`) |
| `PRIME_AGENT_JEV_TOOLS` | empty | comma-separated tools the pre-turn router may replay |

The Jev flags read their OpenRouter key from stored auth (`/login`, `~/.prime/agent/auth.json`). No key, a timeout, or a junk response all mean the gate stays open.

## caveats

- The harness **models** a bill, it doesn't produce one. A prefix break is billed conservatively as a full-turn rewrite; real provider pricing differs. Use it to compare variants deterministically, not to predict an invoice.
- The cap and the TTL change the provider payload, not the durable transcript. Reload and every byte is still there.
- Jev can reject work; it can't corrupt a run. It fails open.
- The idle deadline reaps a child that went quiet. It's not a task timeout and it won't kill a working one.
- The 2-turn payback window is a policy constant, not a law of nature (`IMAGE_TTL_PAYBACK_TURNS` in `image-ttl.ts`, overridable per call). Raise it and you'll capture more long-run savings and eat more short-run losses.
- Source-only. No artifacts, `npm ci` per checkout.

## todos

- check in a real recorded session as a default workload (the loader already takes JSONL, there just isn't a genuine trace in the repo)
- make the payback window configurable instead of a constant
- the janitor only rewrites failed tool results so far — superseded successful dumps are the obvious next target
- a `/context` command that surfaces the per-turn stats instead of only logging them

## acknowledgements

The agent, the harness, the RLM programming model, and all the long-running-work design belong to [Prime Intellect](https://primeintellect.ai) and the Prime Agent authors — I only added the measuring tape and a few switches. Underneath that, the agent and TUI are [`pi`](https://github.com/earendil-works/pi) by [Mario Zechner](https://github.com/mariozechner). Both are worth your stars.

## license

MIT, and the original copyright notice is retained in [LICENSE](LICENSE).

© 2025 Mario Zechner \
© 2026 Dakkshin

## citation

If you use the underlying agent in research, cite the upstream work this derives from:

```bibtex
@article{karten2026prime,
  title={Prime Agent: A Self-Improving RLM Harness},
  author={Karten, Seth and Zhang, Alex L. and Thomas, Kevin and Müller, Sebastian and Bakouch, Elie and Auras, Daniel and Senghaas, Mika and Obeid, Fares and Dunas, Konstantin and Hagemann, Johannes and Jaghouar, Sami},
  journal={arXiv preprint arXiv:2608.23552},
  year={2026}
}
```

Available at [https://arxiv.org/abs/2608.23552](https://arxiv.org/abs/2608.23552).
