import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { estimateTokens } from "./compaction/index.js";

export interface ImageTtlOptions {
	/** Turns an image may stay resident before it is evicted. 0 disables eviction. */
	ttlTurns: number;
	/**
	 * Turns of recovered tokens allowed to repay a prefix break. Overrides
	 * `IMAGE_TTL_PAYBACK_TURNS` for one call; omitted uses the constant.
	 */
	paybackTurns?: number;
}

/**
 * Flat per-image token cost. The production text estimator ignores image data,
 * so every consumer that prices a transcript must add this per resident image.
 */
export const IMAGE_TOKEN_COST = 1200;

/** Token estimate for one message including the flat per-image cost. */
export function estimateMessageTokens(message: AgentMessage): number {
	return estimateTokens(message) + IMAGE_TOKEN_COST * countMessageImages(message);
}

function countMessageImages(message: AgentMessage): number {
	if (message.role !== "user" && message.role !== "toolResult") {
		return 0;
	}
	const content = message.content;
	if (typeof content === "string") {
		return 0;
	}
	let count = 0;
	for (const part of content) {
		if (isImagePart(part)) {
			count += 1;
		}
	}
	return count;
}

export function imageEvictionPlaceholder(mimeType: string, observation?: string): string {
	return observation ? `[image evicted: ${mimeType}; observed: ${observation}]` : `[image evicted: ${mimeType}]`;
}

function isImagePart(part: unknown): part is ImageContent {
	return typeof part === "object" && part !== null && (part as { type?: unknown }).type === "image";
}

/**
 * Replaces images older than `ttlTurns` assistant turns with a text placeholder.
 *
 * Pure and non-destructive: the input array and its message objects are never
 * mutated, and the original array is returned unchanged when nothing is evicted.
 */
export function evictStaleImages(messages: readonly AgentMessage[], options: ImageTtlOptions): AgentMessage[] {
	if (options.ttlTurns <= 0) {
		return messages as AgentMessage[];
	}

	const output = [...messages];
	let assistantsSeen = 0;
	let evicted = false;

	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role === "assistant") {
			assistantsSeen += 1;
			continue;
		}
		if (message.role !== "user" && message.role !== "toolResult") {
			continue;
		}
		const content = message.content;
		if (typeof content === "string" || !content.some(isImagePart)) {
			continue;
		}
		if (assistantsSeen <= options.ttlTurns) {
			continue;
		}
		const observation = message.role === "toolResult" ? message.toolName : undefined;
		const replaced = content.map((part) =>
			isImagePart(part)
				? ({ type: "text", text: imageEvictionPlaceholder(part.mimeType, observation) } as TextContent)
				: part,
		);
		const parts =
			replaced.length > 0 ? replaced : [{ type: "text" as const, text: imageEvictionPlaceholder("unknown") }];
		output[index] = { ...message, content: parts } as AgentMessage;
		evicted = true;
	}

	return evicted ? output : (messages as AgentMessage[]);
}

/** Counts images currently resident in the transcript. */
export function countResidentImages(messages: readonly AgentMessage[]): number {
	let count = 0;
	for (const message of messages) {
		count += countMessageImages(message);
	}
	return count;
}

export interface ImageEvictionPlan {
	/** The evicted view when approved; the original array when deferred. */
	messages: AgentMessage[];
	evictedImages: number;
	/** Tokens recovered from the payload every turn while the eviction stands. */
	recoveredTokens: number;
	/** Tokens of the cached prefix that the eviction forces to be rewritten. */
	breakTokens: number;
	/** Turns of recovered tokens required to repay the break. */
	paybackTurns: number;
	evicted: boolean;
}

/**
 * Payback window for a prefix-breaking eviction. A resident image keeps billing
 * at the cache-read tier, which is cheap; a break rewrites the whole cached
 * prefix. The break is only affordable when the saving repays it quickly.
 */
export const IMAGE_TTL_PAYBACK_TURNS = 2;

/**
 * Prices an eviction before taking it. A break at an image's position rewrites
 * every cached token before it, so the eviction is a one-time cost `breakTokens`
 * against a per-turn saving `recoveredTokens`. Evict only when
 * `recoveredTokens * paybackTurns >= breakTokens`; otherwise the image stays
 * resident and the decision is revisited next turn.
 */
export function planImageEviction(messages: readonly AgentMessage[], options: ImageTtlOptions): ImageEvictionPlan {
	const view = evictStaleImages(messages, options);
	if (view === messages) {
		return {
			messages: view,
			evictedImages: 0,
			recoveredTokens: 0,
			breakTokens: 0,
			paybackTurns: Number.POSITIVE_INFINITY,
			evicted: false,
		};
	}

	let firstChanged = -1;
	let recoveredTokens = 0;
	for (let index = 0; index < messages.length; index += 1) {
		if (view[index] === messages[index]) {
			continue;
		}
		if (firstChanged < 0) {
			firstChanged = index;
		}
		recoveredTokens += estimateMessageTokens(messages[index]) - estimateMessageTokens(view[index]);
	}

	let breakTokens = 0;
	for (let index = 0; index < firstChanged; index += 1) {
		breakTokens += estimateMessageTokens(messages[index]);
	}

	const paybackTurns = recoveredTokens > 0 ? breakTokens / recoveredTokens : Number.POSITIVE_INFINITY;
	const horizon = options.paybackTurns ?? IMAGE_TTL_PAYBACK_TURNS;
	if (paybackTurns > horizon) {
		return {
			messages: messages as AgentMessage[],
			evictedImages: 0,
			recoveredTokens,
			breakTokens,
			paybackTurns,
			evicted: false,
		};
	}

	return {
		messages: view,
		evictedImages: countResidentImages(messages) - countResidentImages(view),
		recoveredTokens,
		breakTokens,
		paybackTurns,
		evicted: true,
	};
}
