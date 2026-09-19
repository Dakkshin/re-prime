<h1 align="center">re-prime</h1>

<p align="center">
  <strong>Cost measurement and opt-in execution controls for long-running RLM agents.</strong><br/>
  Fork of <a href="https://github.com/PrimeIntellect-ai/prime-agent">Prime Agent</a> by <a href="https://primeintellect.ai">Prime Intellect</a>, itself built on <a href="https://github.com/earendil-works/pi">pi</a> by <a href="https://github.com/mariozechner">@mariozechner</a>
</p>

Prime Agent's recursive subagents and persistent REPL are built for work that runs for a long time. That is exactly the workload where a prompt cache quietly becomes a line item. re-prime adds the instrument to measure that cost and four switches to bound it. Base: `prime-agent@976ea10`.

## What this is (and isn't)

- **Is:** upstream Prime Agent plus a deterministic replay harness and four opt-in controls. Every control ships off.
- **Isn't:** an official Prime Intellect release, a binary distribution, or a sandbox. There is no installer; you build from source.
- **Doesn't:** alter flag-off behavior, drop transcript messages, or call a model to rewrite context. Eviction and compression are deterministic and reversible-by-reload.

## Key capabilities

### Measurement

- **Replay harness.** `npm run bench:replay` replays synthetic and recorded transcripts through the real transforms — the tool-output cap and the image-eviction planner — and prices every turn against a simulated SHA-256 prefix cache: `cacheRead`, `cacheWrite`, prefix breaks, tool-result bytes, resident image bytes. No provider, no clock, no RNG; repeated runs are byte-identical.
- **Regression gates.** `--check` exits non-zero unless tool-result bytes fall to ≤20% of raw, `cacheWrite` stays within raw, and prefix breaks stay bounded by eviction events.
- **Per-turn context stats.** Cap, eviction, and janitor counters are logged with the token/byte accounting each provider turn.

### Context budget (opt-in)

- **Tool-output cap.** Oversized tool results keep a head/tail window in the payload; the full output goes to the session scratchpad. It runs at tool-result creation, so it never invalidates a cached prefix.
- **Image TTL with a payback gate.** Stale images become a text placeholder — but only when the recovered tokens repay the cache rewrite within a small window. Otherwise the eviction is deferred and re-priced on the next turn. This is the non-obvious part: a prompt cache is immutable, so evicting a stale screenshot is a capital expense, not cleanup. An eviction that cannot amortize is a regression, and the gate refuses to pay for one.
- **Context janitor.** Superseded failed tool output becomes a deterministic tombstone at most once per window (≥40k tokens and ≥15 turns since the last prune). Tool-call/result pairing survives; messages are never removed. The watermark persists across resume.

### Execution controls (opt-in)

- **Child idle deadline.** A child run with no tracked activity aborts with `RLM_CHILD_ORPHAN_TIMEOUT`; a child with a tool call in flight is exempt.
- **Jev routing.** An OpenRouter-backed classifier can veto a trivial or redundant `rlm.spawn` before it starts, answer a stop/continue question after tool turns, and drive a pre-turn retry router.

## Quickstart

Node.js 22.8.0 or newer. There is no installer — the upstream install script installs upstream Prime Agent, not this repository.

```bash
git clone https://github.com/Dakkshin/re-prime
cd re-prime
npm ci
./prime-agent.sh          # runs from any directory, preserves your cwd
```

On first launch, run `/login`. The agent executes model-generated Python with your user permissions; read [Safety](#safety--disclaimers) before pointing it at anything you care about.

Harness:

```bash
npm run bench:replay               # all workloads, human-readable summary
npm run bench:replay -- --check    # non-zero exit on a gate regression
npm run bench:replay -- --repeat 3 # determinism check
```

## Configuration & environment

Precedence is **env > `contextBudget` settings > default**. Invalid values log a warning and fall back to the default; the resolver never throws.

| Env var | Default | Effect |
|---|---|---|
| `PRIME_AGENT_TOOL_OUTPUT_CAP` | `false` | enable the tool-output cap |
| `PRIME_AGENT_TOOL_OUTPUT_MAX_LINES` | `200` | cap window line budget |
| `PRIME_AGENT_TOOL_OUTPUT_MAX_BYTES` | `16384` | cap window byte budget |
| `PRIME_AGENT_TOOL_OUTPUT_HEAD_RATIO` | `0.6` | head share of the kept window |
| `PRIME_AGENT_IMAGE_TTL` | `false` | enable image TTL eviction |
| `PRIME_AGENT_IMAGE_TTL_TURNS` | `2` | assistant turns before an image becomes eviction-eligible |
| `PRIME_AGENT_CONTEXT_JANITOR` | `false` | enable the context janitor |
| `PRIME_AGENT_CONTEXT_JANITOR_TOKENS` | `40000` | minimum tokens to prune |
| `PRIME_AGENT_CONTEXT_JANITOR_TURNS` | `15` | minimum turns since the last prune |
| `PRIME_AGENT_RLM_CHILD_IDLE_TIMEOUT_MS` | `0` | idle deadline in milliseconds; `0` disables |
| `PRIME_AGENT_JEV_SPAWN_GATE` | `false` | enable the `rlm.spawn` gate |
| `PRIME_AGENT_JEV_ENABLED` | `false` | enable the pre-turn router |
| `PRIME_AGENT_JEV_STOP` | `false` | enable the stop gate (requires `JEV_ENABLED`) |
| `PRIME_AGENT_JEV_TOOLS` | empty | comma-separated tools the pre-turn router may replay |

The Jev flags resolve their OpenRouter key from stored auth (`/login`, `~/.prime/agent/auth.json`). With no key — or on timeout or malformed response — every gate stays open.

## Operational realities

- **The harness models a bill; it does not produce one.** A prefix break is billed conservatively as a full-turn rewrite. Real provider pricing differs. The harness exists to compare variants deterministically, not to predict an invoice.
- **Off by default.** A run with no flags set behaves like upstream. Enabling the cap or TTL changes the provider payload, never the durable transcript.
- **Jev is best-effort.** It can reject work; it cannot corrupt a run. Failures fall open.
- **The idle deadline bounds failure only.** It reaps a child that stopped reporting. It is not a task timeout and never kills a working child.
- **Source-only.** No binaries, no release artifacts. `npm ci` per checkout.

## Safety & disclaimers

> [!WARNING]
> Prime Agent executes model-generated Python and project commands with your user permissions. Its worker and kernel processes improve lifecycle isolation and recovery; they are **not** a security sandbox. Review changes and use trusted repositories, instructions, skills, and extensions only. Run untrusted code or instructions in an external sandbox or restricted environment.

re-prime is an independent derivative, not an official Prime Intellect release.

## Documentation

- [Quickstart](packages/coding-agent/docs/quickstart.md) · [Usage and CLI reference](packages/coding-agent/docs/usage.md) · [Long-running and background agents](packages/coding-agent/docs/long-running-agents.md)
- [RLM programming model](packages/coding-agent/docs/rlm.md) · [Architecture overview](packages/coding-agent/docs/architecture.md) · [Development](packages/coding-agent/docs/development.md)

## Contributing

Issues and pull requests about the execution-engine changes are welcome here. Fixes to the core agent belong upstream in [PrimeIntellect-ai/prime-agent](https://github.com/PrimeIntellect-ai/prime-agent); upstream's [contribution guidelines](CONTRIBUTING.md) and [security policy](SECURITY.md) apply to that project.

## Acknowledgements

re-prime is a fork of [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) by Prime Intellect and its authors (see [Citation](#citation)) — the agent, the harness, and the long-running-work design are theirs. The agent and TUI are in turn built on [`pi`](https://github.com/earendil-works/pi) by [Mario Zechner](https://github.com/mariozechner).

## License

[MIT](LICENSE). The original copyright notice is retained.

© 2025 Mario Zechner<br/>
© 2026 Dakkshin

## Citation

If you use the underlying agent in research, cite the upstream work this repository derives from:

```bibtex
@article{karten2026prime,
  title={Prime Agent: A Self-Improving RLM Harness},
  author={Karten, Seth and Zhang, Alex L. and Thomas, Kevin and Müller, Sebastian and Bakouch, Elie and Auras, Daniel and Senghaas, Mika and Obeid, Fares and Dunas, Konstantin and Hagemann, Johannes and Jaghouar, Sami},
  journal={arXiv preprint arXiv:2608.23552},
  year={2026}
}
```

Available at [https://arxiv.org/abs/2608.23552](https://arxiv.org/abs/2608.23552).
