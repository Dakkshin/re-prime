/**
 * Phase-transition context janitor.
 *
 * Long autonomous runs accumulate multi-turn failure trajectories: a compile
 * flag rejected eight times, a debugger that cannot attach, a port already
 * bound. Those exchanges keep their full error text resident forever while
 * having zero future value once a later call succeeds.
 *
 * The janitor replaces the *content* of those already-superseded failed tool
 * results with a short deterministic tombstone. It never drops a message and
 * never touches the assistant tool call, so tool-call/tool-result pairing stays
 * intact and the provider payload remains valid.
 *
 * Pruning always breaks the cached prefix once, so it is gated behind a phase
 * transition: a token floor AND a minimum turn gap since the previous prune.
 * Between transitions the transform is a pure passthrough.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { classifyJevError } from "@earendil-works/pi-agent-core";
import type { TextContent } from "@earendil-works/pi-ai";
import { estimateContextTokens } from "./compaction/compaction.js";

export const CONTEXT_JANITOR_DEFAULTS = {
	minTokens: 40_000,
	minTurns: 15,
	minFailures: 2,
	activeWindowTurns: 6,
} as const;

export interface ContextJanitorOptions {
	/** Estimated context tokens required before a prune is considered. */
	minTokens: number;
	/** Turns that must elapse since the previous prune. */
	minTurns: number;
	/** Current turn index, strictly increasing within a session. */
	turnIndex: number;
	/** Turn index of the previous prune; -Infinity when the session never pruned. */
	lastPruneTurn: number;
	/** Failed attempts in a trajectory required before it is compressed. */
	minFailures?: number;
	/** Trailing assistant turns kept verbatim. */
	activeWindowTurns?: number;
}

export interface ContextJanitorPlan {
	messages: AgentMessage[];
	changed: boolean;
	trajectoriesCompressed: number;
	messagesCompressed: number;
	estimatedTokensBefore: number;
	estimatedTokensAfter: number;
}

function uniqueInOrder(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		if (!seen.has(value)) {
			seen.add(value);
			result.push(value);
		}
	}
	return result;
}

function textOf(message: AgentMessage): string {
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content) {
		if (typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text") {
			parts.push((part as TextContent).text);
		}
	}
	return parts.join("\n");
}

function isFailedToolResult(message: AgentMessage): boolean {
	return message.role === "toolResult" && message.isError === true;
}

function isAssistantToolCall(message: AgentMessage): boolean {
	return message.role === "assistant" && message.content.some((part) => part.type === "toolCall");
}

/**
 * Index of the first message inside the protected tail, or `messages.length`
 * when the transcript has fewer assistant turns than the active window.
 */
function protectedStartIndex(messages: readonly AgentMessage[], activeWindowTurns: number): number {
	if (activeWindowTurns <= 0) return messages.length;
	let assistantsSeen = 0;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index].role === "assistant") {
			assistantsSeen += 1;
			if (assistantsSeen >= activeWindowTurns) return index;
		}
	}
	return 0;
}

function trajectoryTombstone(failures: readonly { toolName: string; category: string }[], successTool: string): string {
	const tools = uniqueInOrder(failures.map((failure) => failure.toolName));
	const categories = uniqueInOrder(
		failures.map((failure) => failure.category).filter((category) => category !== "NONE"),
	);
	const categoryText = categories.length > 0 ? ` (${categories.join(", ")})` : "";
	const plural = failures.length === 1 ? "attempt" : "attempts";
	return `[Historical execution compressed: ${failures.length} failed ${tools.join("/")} ${plural}${categoryText} superseded by a successful ${successTool} call; prior outputs omitted.]`;
}

function attemptTombstone(toolName: string): string {
	return `[compressed: failed ${toolName} attempt]`;
}

function replaceToolResultContent(message: AgentMessage, text: string): AgentMessage {
	return { ...message, content: [{ type: "text", text }] } as AgentMessage;
}

/**
 * Plans a phase-transition prune. Pure: the input array and its messages are
 * never mutated, and the original array is returned unchanged when the gate is
 * closed or no trajectory qualifies.
 */
export function planContextJanitor(
	messages: readonly AgentMessage[],
	options: ContextJanitorOptions,
): ContextJanitorPlan {
	const empty: ContextJanitorPlan = {
		messages: messages as AgentMessage[],
		changed: false,
		trajectoriesCompressed: 0,
		messagesCompressed: 0,
		estimatedTokensBefore: 0,
		estimatedTokensAfter: 0,
	};
	if (options.turnIndex - options.lastPruneTurn < options.minTurns) {
		return empty;
	}

	let estimatedTokensBefore: number;
	try {
		estimatedTokensBefore = estimateContextTokens([...messages]).tokens;
	} catch {
		return empty;
	}
	if (estimatedTokensBefore < options.minTokens) {
		return empty;
	}

	const minFailures = options.minFailures ?? CONTEXT_JANITOR_DEFAULTS.minFailures;
	const boundary = protectedStartIndex(
		messages,
		options.activeWindowTurns ?? CONTEXT_JANITOR_DEFAULTS.activeWindowTurns,
	);
	const output = [...messages];
	const replacements = new Map<number, string>();
	let trajectoriesCompressed = 0;

	let runStart = -1;
	let runFailures: { index: number; toolName: string; category: string }[] = [];

	const closeRun = (runEnd: number) => {
		if (runStart >= 0 && runFailures.length >= minFailures) {
			const successTool = messages
				.slice(runEnd)
				.find((message) => message.role === "toolResult" && message.isError === false);
			if (successTool && successTool.role === "toolResult") {
				trajectoriesCompressed += 1;
				const summary = trajectoryTombstone(runFailures, successTool.toolName);
				for (const [position, failure] of runFailures.entries()) {
					replacements.set(failure.index, position === 0 ? summary : attemptTombstone(failure.toolName));
				}
			}
		}
		runStart = -1;
		runFailures = [];
	};

	for (let index = 0; index < boundary; index += 1) {
		const message = messages[index];
		if (isAssistantToolCall(message) || isFailedToolResult(message)) {
			if (runStart < 0) runStart = index;
			if (isFailedToolResult(message)) {
				runFailures.push({
					index,
					toolName: (message as { toolName?: string }).toolName ?? "tool",
					category: classifyJevError(textOf(message)),
				});
			}
			continue;
		}
		closeRun(index);
	}
	closeRun(boundary);

	if (replacements.size === 0) {
		return { ...empty, estimatedTokensBefore };
	}

	for (const [index, text] of replacements) {
		output[index] = replaceToolResultContent(output[index], text);
	}

	let estimatedTokensAfter = estimatedTokensBefore;
	try {
		estimatedTokensAfter = estimateContextTokens([...output]).tokens;
	} catch {
		// Reporting is best-effort; the transform itself already succeeded.
	}

	return {
		messages: output,
		changed: true,
		trajectoriesCompressed,
		messagesCompressed: replacements.size,
		estimatedTokensBefore,
		estimatedTokensAfter,
	};
}
