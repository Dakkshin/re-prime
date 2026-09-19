import { Buffer } from "node:buffer";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent, Usage } from "@earendil-works/pi-ai";
import { getLogger } from "@earendil-works/pi-ai";
import { estimateContextTokens } from "./compaction/index.js";

export type ContextStatsContent = ReadonlyArray<TextContent | ImageContent>;

/** Per-turn snapshot of the token and byte drivers behind context growth. */
export interface ContextStats {
	turnIndex: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	toolResultBytes: number;
	imageBytes: number;
	estimatedContextTokens: number;
	toolResultsCapped: number;
	imagesEvicted: number;
	janitorCompressedMessages: number;
}

export interface ContextStatsSnapshotInput {
	turnIndex: number;
	usage: Usage;
	messages: readonly AgentMessage[];
}

export interface ContextStatsAccumulator {
	observeToolResult(content: ContextStatsContent, capped: boolean): void;
	observeEviction(imageCount: number): void;
	observeJanitor(messagesCompressed: number): void;
	snapshot(input: ContextStatsSnapshotInput): ContextStats;
	reset(): void;
}

export type ContextStatsSink = (stats: ContextStats) => void;

/** Turns kept for the /context "recent turns" table. */
export const CONTEXT_STATS_HISTORY_LIMIT = 8;

export interface ContextStatsHistory {
	push(stats: ContextStats): void;
	recent(): ContextStats[];
}

/** Bounded, oldest-first history of per-turn stats. */
export function createContextStatsHistory(limit: number = CONTEXT_STATS_HISTORY_LIMIT): ContextStatsHistory {
	const entries: ContextStats[] = [];
	return {
		push(stats) {
			entries.push(stats);
			if (entries.length > limit) entries.splice(0, entries.length - limit);
		},
		recent() {
			return [...entries];
		},
	};
}

const logger = getLogger("context-stats");

export function utf8Bytes(text: string): number {
	return Buffer.byteLength(text, "utf8");
}

/** Decoded byte length of base64 image data, without allocating the buffer. */
export function estimateBase64Bytes(data: string): number {
	if (data.length === 0) {
		return 0;
	}
	const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
	return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

export function contentByteSize(content: ContextStatsContent): { total: number; image: number } {
	let total = 0;
	let image = 0;
	for (const part of content) {
		if (part.type === "text") {
			total += utf8Bytes(part.text);
		} else if (part.type === "image") {
			const bytes = estimateBase64Bytes(part.data);
			total += bytes;
			image += bytes;
		}
	}
	return { total, image };
}

export function createContextStatsAccumulator(): ContextStatsAccumulator {
	let toolResultBytes = 0;
	let imageBytes = 0;
	let toolResultsCapped = 0;
	let imagesEvicted = 0;
	let janitorCompressedMessages = 0;

	return {
		observeToolResult(content, capped) {
			const size = contentByteSize(content);
			toolResultBytes += size.total;
			imageBytes += size.image;
			if (capped) {
				toolResultsCapped += 1;
			}
		},
		observeEviction(imageCount) {
			imagesEvicted += imageCount;
		},
		observeJanitor(messagesCompressed) {
			janitorCompressedMessages += messagesCompressed;
		},
		snapshot({ turnIndex, usage, messages }) {
			let estimatedContextTokens = 0;
			try {
				estimatedContextTokens = estimateContextTokens([...messages]).tokens;
			} catch {
				estimatedContextTokens = 0;
			}
			return {
				turnIndex,
				inputTokens: usage.input,
				outputTokens: usage.output,
				cacheReadTokens: usage.cacheRead,
				cacheWriteTokens: usage.cacheWrite,
				toolResultBytes,
				imageBytes,
				estimatedContextTokens,
				toolResultsCapped,
				imagesEvicted,
				janitorCompressedMessages,
			};
		},
		reset() {
			toolResultBytes = 0;
			imageBytes = 0;
			toolResultsCapped = 0;
			imagesEvicted = 0;
			janitorCompressedMessages = 0;
		},
	};
}

/** Stable single-line form for the agent log. */
export function formatContextStatsLine(stats: ContextStats): string {
	return [
		`turn=${stats.turnIndex}`,
		`input=${stats.inputTokens}`,
		`output=${stats.outputTokens}`,
		`cacheRead=${stats.cacheReadTokens}`,
		`cacheWrite=${stats.cacheWriteTokens}`,
		`toolResultBytes=${stats.toolResultBytes}`,
		`imageBytes=${stats.imageBytes}`,
		`estContext=${stats.estimatedContextTokens}`,
		`capped=${stats.toolResultsCapped}`,
		`evicted=${stats.imagesEvicted}`,
		`janitor=${stats.janitorCompressedMessages}`,
	].join(" ");
}

export function logContextStats(stats: ContextStats): void {
	logger.info("context stats", { ...stats });
}
