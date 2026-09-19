#!/usr/bin/env npx tsx
/**
 * CLI entrypoint for the deterministic replay harness.
 *
 *   npx tsx benchmarks/run-replay.ts                       # all workloads, human summary
 *   npx tsx benchmarks/run-replay.ts --json                # machine-readable telemetry
 *   npx tsx benchmarks/run-replay.ts --check               # exit 1 if a gate fails
 *   npx tsx benchmarks/run-replay.ts --repeat 3            # determinism check
 *   npx tsx benchmarks/run-replay.ts --workload /path.jsonl
 *
 * Runs outside the test suite and outside the coverage of
 * scripts/check-test-policy.mjs by design; see tasks/spec-phase2.md.
 */

import { stableStringify } from "./lib/billing.js";
import { listWorkloads, loadWorkload } from "./lib/workloads.js";
import { type ReplayGates, type ReplaySuiteReport, runReplaySuite } from "./replay.js";

interface CliOptions {
	workloads: string[];
	json: boolean;
	check: boolean;
	repeat: number;
}

function parseArgs(argv: readonly string[]): CliOptions {
	const options: CliOptions = { workloads: listWorkloads(), json: false, check: false, repeat: 1 };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--json") {
			options.json = true;
		} else if (arg === "--check") {
			options.check = true;
		} else if (arg === "--workload") {
			const value = argv[++index];
			if (!value) throw new Error("--workload requires a name or JSONL path");
			options.workloads = [value];
		} else if (arg === "--repeat") {
			const value = Number(argv[++index]);
			if (!Number.isInteger(value) || value < 1) throw new Error("--repeat requires a positive integer");
			options.repeat = value;
		} else if (arg === "--help" || arg === "-h") {
			console.log(
				"Usage: npx tsx benchmarks/run-replay.ts [--json] [--check] [--repeat N] [--workload <name|path>]",
			);
			process.exit(0);
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return options;
}

function formatGates(label: string, suite: ReplaySuiteReport, gates: ReplayGates): string {
	const textGate =
		suite.baseline.capOpportunities === 0
			? "n/a"
			: gates.toolResultReductionPassed
				? "pass"
				: "FAIL";
	const imageGate =
		suite.baseline.residentImageBytes === 0
			? "n/a"
			: gates.imageReductionPassed
				? "pass"
				: "FAIL";
	const flags = [
		`textBytes=${gates.toolResultRatio.toFixed(3)} ${textGate}`,
		`imageBytes=${gates.imageBytesRatio.toFixed(3)} ${imageGate}`,
		`cacheWrite=${gates.cacheWritePassed ? "pass" : "FAIL"}`,
		`cacheRead=${gates.cacheReadPassed ? "pass" : "FAIL"}`,
		`billed=${gates.billedImproved ? "pass" : "FAIL"}`,
		`breaksBounded=${gates.prefixBreaksBounded ? "pass" : "FAIL"}`,
	];
	return `  ${label.padEnd(10)} ${flags.join("  ")}`;
}

function formatSuite(suite: ReplaySuiteReport): string {
	const lines: string[] = [];
	lines.push(`workload: ${suite.workload}`);
	lines.push(
		"  variant     toolTextBytes   residentImageBytes     cacheRead    cacheWrite        billed  breaks  caps  evicted",
	);
	for (const [label, report] of [
		["raw", suite.baseline],
		["cap", suite.capOnly],
		["ttl", suite.ttlOnly],
		["combined", suite.combined],
	] as const) {
		lines.push(
			[
				`  ${label.padEnd(12)}`,
				String(report.toolResultTextBytes).padStart(14),
				String(report.residentImageBytes).padStart(20),
				String(report.totals.cacheRead).padStart(13),
				String(report.totals.cacheWrite).padStart(13),
				String(report.totals.billedTokens).padStart(13),
				String(report.totals.prefixBreaks).padStart(7),
				String(report.cappedResults).padStart(5),
				String(report.imagesEvicted).padStart(8),
			].join(""),
		);
	}
	lines.push(formatGates("cap-only", suite, suite.gates.capOnly));
	lines.push(formatGates("ttl-only", suite, suite.gates.ttlOnly));
	lines.push(formatGates("combined", suite, suite.gates.combined));
	return lines.join("\n");
}

function assertDeterministic(suites: readonly ReplaySuiteReport[], repeat: number): void {
	if (repeat < 2) return;
	const first = stableStringify(suites);
	for (let run = 2; run <= repeat; run += 1) {
		const next = suites.map((suite) => runReplaySuite(loadWorkload(suite.workload)));
		if (stableStringify(next) !== first) {
			throw new Error(`Replay is not deterministic: run ${run} differs from run 1`);
		}
	}
}

function main(): void {
	const options = parseArgs(process.argv.slice(2));
	const suites = options.workloads.map((name) => runReplaySuite(loadWorkload(name)));
	assertDeterministic(suites, options.repeat);

	if (options.json) {
		console.log(stableStringify({ workloadSuites: suites }));
	} else {
		for (const suite of suites) {
			console.log(formatSuite(suite));
			console.log();
		}
		if (options.repeat > 1) {
			console.log(`determinism: ${options.repeat} runs byte-identical`);
		}
	}

	if (options.check) {
		const failures: string[] = [];
		for (const suite of suites) {
			if (suite.baseline.capOpportunities > 0 && !suite.gates.capOnly.toolResultReductionPassed) {
				failures.push(
					`${suite.workload}: cap gate (tool-result text bytes) ${suite.gates.capOnly.toolResultRatio.toFixed(3)}`,
				);
			}
			if (!suite.gates.capOnly.cacheWritePassed) {
				failures.push(`${suite.workload}: cap gate (cacheWrite penalty)`);
			}
			if (!suite.gates.ttlOnly.cacheWritePassed) {
				failures.push(`${suite.workload}: ttl gate (cacheWrite penalty)`);
			}
			if (!suite.gates.combined.cacheWritePassed) {
				failures.push(`${suite.workload}: combined gate (cacheWrite penalty)`);
			}
			if (!suite.gates.combined.prefixBreaksBounded) {
				failures.push(`${suite.workload}: combined gate (unbounded prefix breaks)`);
			}
		}
		if (failures.length > 0) {
			console.error(`GATE FAILURES:\n  ${failures.join("\n  ")}`);
			process.exit(1);
		}
	}
}

main();
