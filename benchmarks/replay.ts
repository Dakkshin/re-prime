/**
 * Deterministic replay runner.
 *
 * Runs a workload through the real Phase-1 transforms (`capToolOutput`,
 * `evictStaleImages`) with flags off and on, and bills every turn through a
 * simulated prefix cache. No provider, no clock, no RNG: two runs over the same
 * workload produce byte-identical telemetry.
 */

import type { AgentMessage } from "../packages/agent/src/index.js";
import type { ImageContent, TextContent } from "../packages/ai/src/index.js";
import { contentByteSize } from "../packages/coding-agent/src/core/context-stats.js";
import { planImageEviction } from "../packages/coding-agent/src/core/image-ttl.js";
import { capToolOutput, exceedsOutputCap, type ToolOutputCapOptions } from "../packages/coding-agent/src/core/tool-output-cap.js";
import { type BillingTotals, type TurnBilling, PrefixBillingCache, summarizeBilling } from "./lib/billing.js";
import { listWorkloads, loadWorkload, type Workload } from "./lib/workloads.js";

export const DEFAULT_CAP_OPTIONS: ToolOutputCapOptions = { maxLines: 200, maxBytes: 16_384, headRatio: 0.6 };
export const DEFAULT_TTL_TURNS = 2;
/** WS0 acceptance gate: capped tool-result bytes must fall to at most this share of raw. */
export const TOOL_RESULT_REDUCTION_TARGET = 0.2;

export interface ReplayFlags {
	toolOutputCap: boolean;
	imageTtl: boolean;
	capOptions?: ToolOutputCapOptions;
	ttlTurns?: number;
}

export interface ReplayTurn extends TurnBilling {
	toolResultBytes: number;
	toolResultTextBytes: number;
	residentImageBytes: number;
	cappedResults: number;
	imagesEvicted: number;
	evictionEvents: number;
}

export interface ReplayReport {
	workload: string;
	source: string;
	turns: number;
	flags: { toolOutputCap: boolean; imageTtl: boolean };
	totals: BillingTotals;
	toolResultBytes: number;
	toolResultTextBytes: number;
	residentImageBytes: number;
	capOpportunities: number;
	cappedResults: number;
	imagesEvicted: number;
	evictionEvents: number;
	perTurn: ReplayTurn[];
}

export interface ReplayGates {
	toolResultRatio: number;
	toolResultReductionPassed: boolean;
	imageBytesRatio: number;
	imageReductionPassed: boolean;
	cacheWritePassed: boolean;
	cacheReadPassed: boolean;
	billedImproved: boolean;
	prefixBreaksBounded: boolean;
}

function isToolResult(message: AgentMessage): message is AgentMessage & { content: (TextContent | ImageContent)[] } {
	return message.role === "toolResult";
}

export function runReplay(workload: Workload, flags: ReplayFlags): ReplayReport {
	const capOptions = flags.capOptions ?? DEFAULT_CAP_OPTIONS;
	const ttlTurns = flags.ttlTurns ?? DEFAULT_TTL_TURNS;
	const cache = new PrefixBillingCache();
	const transcript: AgentMessage[] = [];
	const perTurn: ReplayTurn[] = [];
	let scratchIndex = 0;

	const writeScratchpad = (text: string): string => {
		scratchIndex += 1;
		void text;
		return `/tmp/prime-bench/${workload.name}/scratch-${scratchIndex}.txt`;
	};

	let totalCapped = 0;
	let totalEvicted = 0;
	let totalEvictionEvents = 0;
	let capOpportunities = 0;

	for (const [turnIndex, turn] of workload.turns.entries()) {
		let turnCapped = 0;
		let toolResultBytes = 0;
		let toolResultTextBytes = 0;

		for (const message of turn.add) {
			if (isToolResult(message)) {
				const joined = message.content
					.filter((part): part is TextContent => part.type === "text")
					.map((part) => part.text)
					.join("\n");
				if (exceedsOutputCap(joined, capOptions)) capOpportunities += 1;
			}
			let next = message;
			if (flags.toolOutputCap && isToolResult(message)) {
				const capped = capToolOutput({
					content: message.content,
					options: capOptions,
					writeScratchpad,
				});
				if (capped.capped) {
					turnCapped += 1;
					next = { ...message, content: capped.content } as AgentMessage;
				}
			}
			if (next.role === "toolResult") {
				const size = contentByteSize(next.content);
				toolResultBytes += size.total;
				toolResultTextBytes += size.total - size.image;
			}
			transcript.push(next);
		}

		let evictedThisTurn = 0;
		let view = transcript;
		if (flags.imageTtl) {
			const plan = planImageEviction(transcript, { ttlTurns });
			view = plan.messages;
			evictedThisTurn = plan.evictedImages;
		}

		const billing = cache.bill(view, turnIndex);
		totalCapped += turnCapped;
		totalEvicted += evictedThisTurn;
		if (evictedThisTurn > 0) totalEvictionEvents += 1;

		perTurn.push({
			...billing,
			toolResultBytes,
			toolResultTextBytes,
			residentImageBytes: countResidentImageBytes(view),
			cappedResults: turnCapped,
			imagesEvicted: evictedThisTurn,
			evictionEvents: evictedThisTurn > 0 ? 1 : 0,
		});
	}

	return {
		workload: workload.name,
		source: workload.source,
		turns: workload.turns.length,
		flags: { toolOutputCap: flags.toolOutputCap, imageTtl: flags.imageTtl },
		totals: summarizeBilling(perTurn),
		toolResultBytes: perTurn.reduce((total, turn) => total + turn.toolResultBytes, 0),
		toolResultTextBytes: perTurn.reduce((total, turn) => total + turn.toolResultTextBytes, 0),
		residentImageBytes: perTurn.reduce((total, turn) => total + turn.residentImageBytes, 0),
		capOpportunities,
		cappedResults: totalCapped,
		imagesEvicted: totalEvicted,
		evictionEvents: totalEvictionEvents,
		perTurn,
	};
}

function countResidentImageBytes(messages: readonly AgentMessage[]): number {
	let bytes = 0;
	for (const message of messages) {
		if (message.role === "toolResult") bytes += contentByteSize(message.content).image;
	}
	return bytes;
}

/** Compares a variant against the raw baseline. */
export function compareReports(baseline: ReplayReport, variant: ReplayReport): ReplayGates {
	const toolResultRatio =
		baseline.toolResultTextBytes === 0 ? 1 : variant.toolResultTextBytes / baseline.toolResultTextBytes;
	const imageBytesRatio =
		baseline.residentImageBytes === 0 ? 1 : variant.residentImageBytes / baseline.residentImageBytes;
	return {
		toolResultRatio,
		toolResultReductionPassed: toolResultRatio <= TOOL_RESULT_REDUCTION_TARGET,
		imageBytesRatio,
		imageReductionPassed: baseline.residentImageBytes === 0 || imageBytesRatio <= TOOL_RESULT_REDUCTION_TARGET,
		cacheWritePassed: variant.totals.cacheWrite <= baseline.totals.cacheWrite,
		cacheReadPassed: variant.totals.cacheRead <= baseline.totals.cacheRead,
		billedImproved: variant.totals.billedTokens <= baseline.totals.billedTokens,
		prefixBreaksBounded: variant.totals.prefixBreaks <= variant.evictionEvents,
	};
}

export interface ReplaySuiteReport {
	workload: string;
	baseline: ReplayReport;
	capOnly: ReplayReport;
	ttlOnly: ReplayReport;
	combined: ReplayReport;
	gates: {
		capOnly: ReplayGates;
		ttlOnly: ReplayGates;
		combined: ReplayGates;
	};
}

export function runReplaySuite(workload: Workload): ReplaySuiteReport {
	const baseline = runReplay(workload, { toolOutputCap: false, imageTtl: false });
	const capOnly = runReplay(workload, { toolOutputCap: true, imageTtl: false });
	const ttlOnly = runReplay(workload, { toolOutputCap: false, imageTtl: true });
	const combined = runReplay(workload, { toolOutputCap: true, imageTtl: true });
	return {
		workload: workload.name,
		baseline,
		capOnly,
		ttlOnly,
		combined,
		gates: {
			capOnly: compareReports(baseline, capOnly),
			ttlOnly: compareReports(baseline, ttlOnly),
			combined: compareReports(baseline, combined),
		},
	};
}

export function replayAll(workloadNames: readonly string[] = listWorkloads()): ReplaySuiteReport[] {
	return workloadNames.map((name) => runReplaySuite(loadWorkload(name)));
}
