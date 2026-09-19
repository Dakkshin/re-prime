/**
 * Jev spawn admission gate.
 *
 * `rlm.spawn` is the only way a turn multiplies into independent context sinks;
 * a trivial or redundant delegation costs a full child session for work the
 * parent could finish with one read. When `PRIME_AGENT_JEV_SPAWN_GATE` is
 * enabled, the prospective task is classified before the child runtime is
 * created, and an inline or redundant verdict rejects the spawn outright.
 *
 * Fail-open by construction: a missing key, timeout, transport error, or
 * malformed answer yields `unknown`, which permits the spawn. Disabled by
 * default; with the flag unset no classifier is ever built.
 */

import type { JevClassifier, JevDecision } from "@earendil-works/pi-agent-core";
import { DEFAULT_JEV_MIN_CONFIDENCE, evaluateJevDecision } from "@earendil-works/pi-agent-core";
import { createOpenRouterJevClassifier, type JevApiKeyResolver } from "./jev-openrouter.js";
import { JEV_MAX_ENTROPY, JEV_MIN_PROBABILITY } from "./jev-router.js";

/** Environment flag enabling the spawn admission gate. */
export const JEV_SPAWN_GATE_ENV = "PRIME_AGENT_JEV_SPAWN_GATE";
/** Choice: the subtask needs its own isolated sandbox. */
export const JEV_DELEGATE_CHOICE = "DELEGATE_SANDBOX";
/** Choice: the parent can finish the subtask inline with local tools. */
export const JEV_INLINE_CHOICE = "EXECUTE_INLINE";
/** Choice: the subtask duplicates existing work or adds nothing. */
export const JEV_REJECT_CHOICE = "REJECT_REDUNDANT";
/** Marker prefix on the rejection error, stable for callers and tests. */
export const JEV_DELEGATION_REJECTED_PREFIX = "DELEGATION_REJECTED";

export const JEV_SPAWN_CHOICES = [JEV_DELEGATE_CHOICE, JEV_INLINE_CHOICE, JEV_REJECT_CHOICE] as const;

export type JevSpawnVerdict = "delegate" | "inline" | "redundant" | "unknown";

const SPAWN_INSTRUCTIONS =
	"Decide whether this prospective rlm.spawn subtask needs its own isolated sandbox, or whether the parent can resolve it inline with a simple read/grep/bash. Prefer DELEGATE_SANDBOX when the subtask needs isolated state, its own long-running execution, or independent verification. Choose EXECUTE_INLINE for trivial local work. Choose REJECT_REDUNDANT when the work is already done or adds no independent value.";
const SPAWN_CRITERIA: Record<string, string> = {
	[JEV_DELEGATE_CHOICE]: "The subtask needs an isolated sandbox, independent state, or long-running execution",
	[JEV_INLINE_CHOICE]: "The subtask is trivial local work the parent can run directly",
	[JEV_REJECT_CHOICE]: "The subtask is redundant with work already done or adds no value",
};

export const JEV_DELEGATION_INLINE_MESSAGE = "DELEGATION_REJECTED: Task can be completed inline using local tools.";
export const JEV_DELEGATION_REDUNDANT_MESSAGE = "DELEGATION_REJECTED: Task is redundant; resolve it inline.";

/** True when the opt-in spawn gate is enabled for this process. */
export function isJevSpawnGateEnabled(env: Record<string, string | undefined> = process.env): boolean {
	const value = env[JEV_SPAWN_GATE_ENV]?.trim().toLowerCase();
	return value === "1" || value === "true" || value === "yes";
}

/** Maps a gated classifier decision onto a spawn verdict. */
export function verdictForDecision(decision: JevDecision | undefined): JevSpawnVerdict {
	if (!decision || decision.action !== "EXECUTE_TOOL") {
		return "unknown";
	}
	switch (decision.toolName) {
		case JEV_DELEGATE_CHOICE:
			return "delegate";
		case JEV_INLINE_CHOICE:
			return "inline";
		case JEV_REJECT_CHOICE:
			return "redundant";
		default:
			return "unknown";
	}
}

/** Throws when the verdict rejects the spawn. `delegate` and `unknown` pass. */
export function assertDelegationAllowed(verdict: JevSpawnVerdict): void {
	if (verdict === "inline") {
		throw new Error(JEV_DELEGATION_INLINE_MESSAGE);
	}
	if (verdict === "redundant") {
		throw new Error(JEV_DELEGATION_REDUNDANT_MESSAGE);
	}
}

export interface JevSpawnGateOptions {
	/** Injected classifier, mainly for tests. */
	classifier?: JevClassifier;
	apiKey?: string;
	resolveApiKey?: JevApiKeyResolver;
	model?: string;
	minConfidence?: number;
	env?: Record<string, string | undefined>;
}

export type JevSpawnGate = (goal: string | undefined, task: string) => Promise<JevSpawnVerdict>;

/**
 * Builds a spawn verdict function. The classifier sees the parent goal and the
 * prospective task; only a decision that clears both the confidence floor and
 * the concentrated-entropy bar can reject a spawn.
 */
export function createJevSpawnGate(options: JevSpawnGateOptions = {}): JevSpawnGate {
	const classifier =
		options.classifier ??
		createOpenRouterJevClassifier({
			tools: JEV_SPAWN_CHOICES,
			instructions: SPAWN_INSTRUCTIONS,
			criteria: SPAWN_CRITERIA,
			...(options.apiKey ? { apiKey: options.apiKey } : {}),
			...(options.resolveApiKey ? { resolveApiKey: options.resolveApiKey } : {}),
			...(options.model ? { model: options.model } : {}),
		});
	const minConfidence = options.minConfidence ?? DEFAULT_JEV_MIN_CONFIDENCE;

	return async (goal, task) => {
		try {
			const decision = await classifier({
				turnIndex: 0,
				consecutiveFailures: 0,
				...(goal ? { goal } : {}),
				lastToolName: "rlm.spawn",
				lastAssistantText: `Prospective subtask: ${task}`,
			});
			const gated = evaluateJevDecision(decision, {
				minConfidence,
				allowedTools: JEV_SPAWN_CHOICES,
				minProbability: JEV_MIN_PROBABILITY,
				maxEntropy: JEV_MAX_ENTROPY,
			});
			return verdictForDecision(gated);
		} catch {
			return "unknown";
		}
	};
}
