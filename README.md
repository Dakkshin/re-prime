<h1 align="center">re-prime</h1>

<p align="center">
  <strong>A zero-bloat execution engine for long-running RLM agents.</strong><br/>
  Fork of <a href="https://github.com/PrimeIntellect-ai/prime-agent">Prime Agent</a> by <a href="https://primeintellect.ai">Prime Intellect</a> &bull; built on <a href="https://github.com/earendil-works/pi">pi</a> by <a href="https://github.com/mariozechner">@mariozechner</a>
</p>

re-prime keeps the upstream agent intact and adds deterministic cost measurement plus opt-in execution controls, so long autonomous runs can be measured, bounded, and audited instead of guessed at. It is an independent derivative, not an official Prime Intellect release.

Base: `prime-agent@976ea10`.

## What re-prime adds

- **Deterministic replay harness.** `npm run bench:replay` replays synthetic and recorded transcripts through the real context transforms and prices every turn against a simulated SHA-256 prefix cache: `cacheRead`, `cacheWrite`, prefix breaks, tool-result bytes, and resident image bytes. No provider, no clock, no RNG — repeated runs are byte-identical, and `--check` fails the run on a cache-write regression.
- **Cache-accounted tool-output cap** (opt-in). Oversized tool results are replaced by a head/tail window with the full output written to the session scratchpad, shrinking the provider payload without altering the durable transcript.
- **Image TTL with a payback gate** (opt-in). Stale images are replaced by a text placeholder only when the recovered tokens repay the prompt-cache rewrite within a small payback window. A deferred eviction is re-priced on every turn, so enabling the TTL never taxes a short session.
- **Phase-transition context janitor** (opt-in). Superseded failed tool output is compressed into deterministic tombstones at most once per window (`>= 40000` tokens and `>= 15` turns since the last prune), with the watermark persisted across resume. Messages are never dropped; tool-call/result pairing is preserved.
- **Per-turn context statistics.** Each provider turn logs token and byte accounting plus cap/eviction/janitor counters, so steady-state spend is visible after the fact.
- **RLM child idle deadline** (opt-in). A child run that stops producing activity is aborted with `RLM_CHILD_ORPHAN_TIMEOUT` instead of lingering; a child with a tool call in flight is exempt.
- **Jev routing** (opt-in). An OpenRouter-backed classifier can screen `rlm.spawn` delegations before they start, answer a stop/continue question after tool turns, and drive a pre-turn retry router.

All controls ship disabled. A run with no flags set behaves like upstream.

### Flags

| Env var | Default | Effect |
|---|---|---|
| `PRIME_AGENT_TOOL_OUTPUT_CAP` | `false` | enable the tool-output cap |
| `PRIME_AGENT_TOOL_OUTPUT_MAX_LINES` / `_MAX_BYTES` / `_HEAD_RATIO` | `200` / `16384` / `0.6` | cap window shape |
| `PRIME_AGENT_IMAGE_TTL` | `false` | enable image TTL eviction |
| `PRIME_AGENT_IMAGE_TTL_TURNS` | `2` | assistant turns an image may stay resident before it becomes eviction-eligible |
| `PRIME_AGENT_CONTEXT_JANITOR` | `false` | enable the context janitor |
| `PRIME_AGENT_CONTEXT_JANITOR_TOKENS` / `_TURNS` | `40000` / `15` | prune thresholds |
| `PRIME_AGENT_RLM_CHILD_IDLE_TIMEOUT_MS` | `0` (off) | abort an idle child run after this many milliseconds |
| `PRIME_AGENT_JEV_SPAWN_GATE` | `false` | reject trivial or redundant `rlm.spawn` delegations |
| `PRIME_AGENT_JEV_ENABLED` | `false` | enable the Jev pre-turn router |
| `PRIME_AGENT_JEV_STOP` | `false` | enable the Jev stop gate (requires `PRIME_AGENT_JEV_ENABLED`) |
| `PRIME_AGENT_JEV_TOOLS` | empty | comma-separated allow-list of tools the pre-turn router may replay |

The Jev flags resolve their OpenRouter key from the agent's stored auth (`/login`, `~/.prime/agent/auth.json`). With no key, every gate fails open.

## Build and run from source

re-prime is source-only: the upstream installer script installs upstream Prime Agent, not this repository. Requires Node.js 22.8.0 or newer.

```bash
git clone https://github.com/Dakkshin/re-prime
cd re-prime
npm ci
/path/to/re-prime/prime-agent.sh
```

`prime-agent.sh` can be invoked from any directory and preserves the caller's working directory. See [Development](packages/coding-agent/docs/development.md) for build details and repository rules.

> [!WARNING]
> Prime Agent executes model-generated Python and project commands with your user permissions. Its worker and kernel processes improve lifecycle isolation and recovery; they are **not** a security sandbox. Review changes and use trusted repositories, instructions, skills, and extensions only. Run untrusted code or instructions in an external sandbox or restricted environment.

## What you get from upstream

The full Prime Agent feature set remains available: a persistent Python REPL where file operations, shell commands, subagents, and context management happen programmatically; `rlm.spawn(...)` subagents; the Continual Harness (`/refine`); importable skills; daemon-backed background sessions; agent-to-agent messaging; persistent goals, heartbeats, schedules, and bounded autonomous mode. See the [documentation index](packages/coding-agent/docs/index.md) for the complete guide.

## Documentation

- [Quickstart](packages/coding-agent/docs/quickstart.md) — install, authenticate, and run a first session
- [Usage and CLI reference](packages/coding-agent/docs/usage.md) — commands, sessions, autonomous limits, and output modes
- [Long-running and background agents](packages/coding-agent/docs/long-running-agents.md) — detach and reattach, goals, heartbeats, and schedules
- [RLM programming model](packages/coding-agent/docs/rlm.md) — the persistent Python REPL, subagents, skills, and the trust model
- [Architecture overview](packages/coding-agent/docs/architecture.md) — daemon, worker, kernel, and persistence boundaries
- [Development](packages/coding-agent/docs/development.md) — build and run from source

## Contributing

This repository is an independent derivative. Issues and pull requests about the execution-engine changes are welcome here. Fixes to the core agent belong upstream in [PrimeIntellect-ai/prime-agent](https://github.com/PrimeIntellect-ai/prime-agent); upstream's [contribution guidelines](CONTRIBUTING.md) and [security policy](SECURITY.md) apply to that project.

## Acknowledgements

re-prime is a fork of [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent) by Prime Intellect and its authors (see [Citation](#citation)) — the agent, the harness, and the long-running-work design are theirs. The agent and TUI are in turn built on [`pi`](https://github.com/earendil-works/pi) by [Mario Zechner](https://github.com/mariozechner). We thank both.

## License

re-prime is released under the [MIT License](LICENSE). The original copyright notice is retained.

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
