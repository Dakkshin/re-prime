# Security Policy

## What re-prime is

re-prime is a fork of [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent).
It runs model-generated code with your user permissions. It is **not a sandbox**
and does not claim to be one. Use a disposable checkout or something you have
backed up.

The upstream project carries the security posture for the agent itself; report
vulnerabilities in the agent there.

## Reporting a Vulnerability

Do not report security vulnerabilities through public Issues, Discussions, or
pull requests.

- **Agent, TUI, providers, MCP, daemon:** report to
  [security@primeintellect.ai](mailto:security@primeintellect.ai). For encrypted
  communication and the current disclosure policy, see
  [primeintellect.ai/security](https://www.primeintellect.ai/security).
- **re-prime's own surface** (the replay harness, the context-budget flags, the
  janitor, the child deadline, the spawn gate): open a private security advisory
  on [Dakkshin/re-prime](https://github.com/Dakkshin/re-prime/security/advisories/new).

Include the following when possible:

- The affected version or commit
- The affected component and environment
- Reproduction steps or a minimal proof of concept
- The expected and observed impact
- Any known mitigations

Do not include real API keys, tokens, personal data, or credentials in the
report. Use redacted or disposable test values.

## Credentials

re-prime reads provider credentials from stored auth (`/login`,
`~/.prime/agent/auth.json`) and from environment variables; it does not add a
credential store of its own. The harness never uses a credential: the replay is
offline and has no provider, clock, or RNG. The trace converter
(`benchmarks/lib/convert-session.ts`) redacts home paths, the local username, and
common credential shapes before a fixture is committed, and `benchmark --check`
re-runs that redaction over every committed fixture.

## What to Expect

Maintainers will assess the report, determine its scope, and coordinate
remediation and disclosure when appropriate. Please allow time for investigation
before publishing details that could put users at risk.

For ordinary bugs and support questions, use
[GitHub Issues](https://github.com/Dakkshin/re-prime/issues).
