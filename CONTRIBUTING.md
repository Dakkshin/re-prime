# Contributing to re-prime

re-prime is a personal fork of [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent).
The agent, the harness, the RLM programming model, and all long-running-work
design belong to Prime Intellect and the Prime Agent authors; re-prime only adds
a measuring tape and a few switches. Upstream is where the project actually
lives, and contributions to the agent belong there, not here.

## Where to send what

| you want to... | go to |
|---|---|
| report a bug in the agent, TUI, providers, or MCP | [upstream Discussions](https://github.com/PrimeIntellect-ai/prime-agent/discussions) |
| report a bug in the replay harness, a context flag, or the janitor | open an issue on [Dakkshin/re-prime](https://github.com/Dakkshin/re-prime/issues) |
| contribute a feature to the agent | upstream, via the process below |
| suggest a change to the harness or a flag default | an issue on this fork first |

## Upstream's process

Prime Agent develops in public but gates implementation deliberately: start in
[GitHub Discussions](https://github.com/PrimeIntellect-ai/prime-agent/discussions),
and wait for a maintainer to invite a pull request before starting substantial
work. Issues track accepted work only; unsolicited pull requests are closed.
Prime Agent runs on user machines with the user's permissions, so pull requests
are limited to maintainers and explicitly vouched-for contributors. See
upstream's `CONTRIBUTING.md` for the current wording.

## Working in this fork

If you are working on re-prime's own surface (the harness, the budget flags, the
janitor, the deadline, the spawn gate):

1. Read `AGENTS.md` — it is the source of truth for dev rules.
2. Keep the change opt-in. Flag-off behavior must stay byte-identical to
   upstream; a transform that changes the default payload is a bug.
3. Add or update tests. The test policy is enforced by
   `npm run check:test-policy` and is not to be weakened.
4. Run `npm run check` and `npx tsx benchmarks/run-replay.ts --repeat 3 --check`.
5. Add a changelog fragment per touched package
   (`packages/<pkg>/.changes/<slug>.md`); see `AGENTS.md`.

## Changelog entries

Do not edit `packages/*/CHANGELOG.md` directly. Add one fragment file per change
per touched package: `packages/<pkg>/.changes/<slug>.md`, containing the bullet
line(s) that describe the change. The release script aggregates fragments into
the release section and deletes them.

## License

re-prime is MIT, and the original copyright notice is retained in `LICENSE`.
By contributing, you agree your contribution is licensed under the same terms.
