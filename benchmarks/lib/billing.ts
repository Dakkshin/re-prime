/**
 * Deterministic token accounting and prefix-cache billing for the replay
 * harness. No clock, no RNG, no provider: the same input always bills the same.
 *
 * Billing model (frozen for Checkpoint A):
 * - A turn whose previous transcript is an intact prefix of the new one reads
 *   that prefix from cache (`cacheRead = prefixTokens`) and writes only the
 *   appended messages (`cacheWrite = newTokens`).
 * - A turn that rewrites an older message breaks the prefix. Per the WS0
 *   acceptance criteria the penalty is conservative: the whole turn is billed
 *   as `cacheWrite = totalTokens`.
 */

import { createHash } from "node:crypto";
import type { AgentMessage } from "../../packages/agent/src/index.js";
import { IMAGE_TOKEN_COST, estimateMessageTokens } from "../../packages/coding-agent/src/core/image-ttl.js";

export { IMAGE_TOKEN_COST };

export interface TurnBilling {
	turnIndex: number;
	totalTokens: number;
	prefixTokens: number;
	newTokens: number;
	cacheRead: number;
	cacheWrite: number;
	billedTokens: number;
	/** True when an older message changed and the cached prefix had to be rebuilt. */
	prefixBreak: boolean;
	/** Hash of the intact shared prefix, for cross-run determinism checks. */
	prefixHash: string;
}

export interface BillingTotals {
	cacheRead: number;
	cacheWrite: number;
	billedTokens: number;
	finalContextTokens: number;
	prefixBreaks: number;
}

export function stableStringify(value: unknown): string {
	if (value === undefined) return "null";
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, entry]) => entry !== undefined)
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
	return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

/** Token estimate for one message, including the flat per-image cost. */
export function countMessageTokens(message: AgentMessage): number {
	return estimateMessageTokens(message);
}

export function countTranscriptTokens(messages: readonly AgentMessage[]): number {
	return messages.reduce((total, message) => total + countMessageTokens(message), 0);
}

function hashPrefix(serializedPrefix: readonly string[]): string {
	const hash = createHash("sha256");
	for (const message of serializedPrefix) {
		hash.update(message);
		hash.update("\n");
	}
	return hash.digest("hex").slice(0, 16);
}

/** Bills one turn against the transcript produced by the previous turn. */
export class PrefixBillingCache {
	private previousSerialized: readonly string[] | undefined;
	private previousTokens: readonly number[] | undefined;

	bill(messages: readonly AgentMessage[], turnIndex: number): TurnBilling {
		const serialized = messages.map(stableStringify);
		const tokenCounts = messages.map(countMessageTokens);
		const totalTokens = tokenCounts.reduce((total, count) => total + count, 0);

		let shared = 0;
		if (this.previousSerialized) {
			const limit = Math.min(this.previousSerialized.length, serialized.length);
			while (shared < limit && this.previousSerialized[shared] === serialized[shared]) {
				shared += 1;
			}
		}

		const prefixTokens = tokenCounts.slice(0, shared).reduce((total, count) => total + count, 0);
		const newTokens = totalTokens - prefixTokens;
		const firstTurn = this.previousSerialized === undefined;
		const prefixBreak = !firstTurn && shared < this.previousSerialized!.length;
		const cacheRead = firstTurn ? 0 : prefixTokens;
		const cacheWrite = firstTurn || prefixBreak ? totalTokens : newTokens;

		this.previousSerialized = serialized;
		this.previousTokens = tokenCounts;

		return {
			turnIndex,
			totalTokens,
			prefixTokens,
			newTokens,
			cacheRead,
			cacheWrite,
			billedTokens: cacheRead + cacheWrite,
			prefixBreak,
			prefixHash: hashPrefix(serialized.slice(0, shared)),
		};
	}

	/** Tokens resident in the transcript after the last billed turn. */
	get residentTokens(): number {
		return this.previousTokens?.reduce((total, count) => total + count, 0) ?? 0;
	}
}

export function summarizeBilling(turns: readonly TurnBilling[]): BillingTotals {
	return {
		cacheRead: turns.reduce((total, turn) => total + turn.cacheRead, 0),
		cacheWrite: turns.reduce((total, turn) => total + turn.cacheWrite, 0),
		billedTokens: turns.reduce((total, turn) => total + turn.billedTokens, 0),
		finalContextTokens: turns.length > 0 ? turns[turns.length - 1].totalTokens : 0,
		prefixBreaks: turns.reduce((total, turn) => total + (turn.prefixBreak ? 1 : 0), 0),
	};
}
