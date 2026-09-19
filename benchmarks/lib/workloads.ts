/**
 * Deterministic replay workloads.
 *
 * A workload is a list of turns; each turn appends messages to the transcript.
 * Two sources are supported:
 * - synthetic archetypes generated in code (exact byte sizes, no RNG);
 * - a JSONL trace file. The compact trace schema is:
 *
 *   {"turn":0,"add":[{"role":"user","text":"..."}]}
 *   {"turn":1,"add":[
 *     {"role":"assistant","text":"...","toolCall":{"name":"bash","arguments":{...}}},
 *     {"role":"toolResult","toolName":"bash","toolCallId":"t1","text":"...","isError":true}]}
 *
 *   An entry carrying `content` is treated as a raw AgentMessage and passed
 *   through unchanged, so a recorded production session can be replayed by
 *   dropping its JSONL in and pointing the loader at the path.
 */

import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentMessage } from "../../packages/agent/src/index.js";
import type {
	AssistantMessage,
	ImageContent,
	TextContent,
	ToolResultMessage,
	Usage,
	UserMessage,
} from "../../packages/ai/src/index.js";

export interface TurnRecord {
	/** Messages appended to the transcript this turn. */
	add: AgentMessage[];
}

export interface Workload {
	name: string;
	source: "synthetic" | "trace";
	turns: TurnRecord[];
}

export const TEXT_DUMP_BYTES = 100 * 1024;
export const IMAGE_DECODED_BYTES = 200 * 1024;

const BASE_TIMESTAMP = 1_700_000_000_000;

const EMPTY_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function userMessage(text: string, offset: number): UserMessage {
	return { role: "user", content: text, timestamp: BASE_TIMESTAMP + offset };
}

function assistantMessage(
	text: string,
	toolCall: { name: string; arguments: Record<string, unknown> } | undefined,
	offset: number,
): AssistantMessage {
	const content: AssistantMessage["content"] = [];
	if (text.length > 0) content.push({ type: "text", text });
	if (toolCall) {
		content.push({ type: "toolCall", id: `bench-${offset}`, name: toolCall.name, arguments: toolCall.arguments });
	}
	return {
		role: "assistant",
		content,
		api: "bench",
		provider: "bench",
		model: "bench",
		usage: EMPTY_USAGE,
		stopReason: toolCall ? "toolUse" : "stop",
		timestamp: BASE_TIMESTAMP + offset,
	};
}

function toolResultMessage(
	toolCallId: string,
	toolName: string,
	content: (TextContent | ImageContent)[],
	isError: boolean,
	offset: number,
): ToolResultMessage {
	return { role: "toolResult", toolCallId, toolName, content, isError, timestamp: BASE_TIMESTAMP + offset };
}

function textContent(text: string): TextContent {
	return { type: "text", text };
}

/** Deterministic filler of exactly `targetBytes` bytes (ASCII, so chars == bytes). */
export function textDump(targetBytes: number, seed: number): string {
	const header = "// deterministic replay payload\n";
	let out = header;
	let line = 0;
	while (out.length < targetBytes) {
		out += `  int field_${line} = ${(line * seed) % 997}; // filler line for the replay harness\n`;
		line += 1;
	}
	return out.slice(0, targetBytes);
}

/** Deterministic base64 image payload decoding to exactly `decodedBytes` bytes. */
export function base64Image(decodedBytes: number): string {
	const buffer = Buffer.allocUnsafe(decodedBytes);
	for (let index = 0; index < decodedBytes; index += 1) {
		buffer[index] = (index * 31 + 7) % 256;
	}
	return buffer.toString("base64");
}

interface CompactToolCall {
	name: string;
	arguments: Record<string, unknown>;
}

type TraceEntry =
	| { role: "user"; text: string }
	| { role: "assistant"; text?: string; toolCall?: CompactToolCall }
	| { role: "toolResult"; toolName: string; toolCallId: string; text: string; isError?: boolean }
	| AgentMessage;

function isRawMessage(entry: TraceEntry): entry is AgentMessage {
	return typeof entry === "object" && entry !== null && "content" in entry;
}

function expandTraceEntry(entry: TraceEntry, turn: number, index: number): AgentMessage {
	const offset = turn * 100 + index;
	if (isRawMessage(entry)) return entry;
	switch (entry.role) {
		case "user":
			return userMessage(entry.text, offset);
		case "assistant":
			return assistantMessage(entry.text ?? "", entry.toolCall, offset);
		case "toolResult":
			return toolResultMessage(
				entry.toolCallId,
				entry.toolName,
				[textContent(entry.text)],
				entry.isError ?? false,
				offset,
			);
		default:
			throw new Error(`Unsupported trace entry role at turn ${turn}: ${JSON.stringify(entry)}`);
	}
}

interface TraceTurn {
	turn: number;
	add: TraceEntry[];
}

export function loadTrace(path: string): Workload {
	const lines = readFileSync(path, "utf8")
		.split("\n")
		.filter((line) => line.trim().length > 0);
	const turns: TurnRecord[] = [];
	for (const line of lines) {
		const parsed = JSON.parse(line) as TraceTurn;
		if (typeof parsed.turn !== "number" || !Array.isArray(parsed.add)) {
			throw new Error(`Malformed trace line in ${path}: expected {turn, add[]}`);
		}
		turns.push({ add: parsed.add.map((entry, index) => expandTraceEntry(entry, parsed.turn, index)) });
	}
	return { name: basename(path), source: "trace", turns };
}

export function assaultCubeTrace(): Workload {
	const path = fileURLToPath(new URL("../fixtures/assaultcube-trace.jsonl", import.meta.url));
	const workload = loadTrace(path);
	return { ...workload, name: "assaultcube" };
}

export interface HeavyToolRunOptions {
	/** Extra plain read turns appended after the payload turns (amortizes one-time transforms). */
	extraTurns?: number;
}

/**
 * The observed failure archetype: a long transcript that dumps a large source
 * file, attaches a screenshot, and keeps reading. Both payload turns exceed the
 * tool-output cap, and the screenshot goes stale under the image TTL.
 */
export function heavyToolRun(options: HeavyToolRunOptions = {}): Workload {
	const smallDump = textDump(30 * 1024, 7);
	const turns: TurnRecord[] = [
		{ add: [userMessage("Read server.cpp, then screenshot the running server and summarize the build.", 0)] },
		{
			add: [
				assistantMessage("Reading the source file.", { name: "bash", arguments: { command: "cat server.cpp" } }, 1),
				toolResultMessage(
					"bench-1",
					"bash",
					[textContent(textDump(TEXT_DUMP_BYTES, 13))],
					false,
					1,
				),
			],
		},
		{ add: [assistantMessage("The file is large. Checking the build output next.", undefined, 2)] },
		{
			add: [
				assistantMessage("Capturing the server window.", { name: "screenshot", arguments: {} }, 3),
				toolResultMessage(
					"bench-3",
					"screenshot",
					[{ type: "image", data: base64Image(IMAGE_DECODED_BYTES), mimeType: "image/png" }],
					false,
					3,
				),
			],
		},
		{ add: [assistantMessage("Screenshot captured; reading the Makefile.", undefined, 4)] },
		{
			add: [
				assistantMessage("Reading the Makefile.", { name: "bash", arguments: { command: "cat Makefile" } }, 5),
				toolResultMessage("bench-5", "bash", [textContent(smallDump)], false, 5),
			],
		},
		{ add: [assistantMessage("Makefile read; cross-checking the linker flags.", undefined, 6)] },
		{ add: [assistantMessage("Build looks reproducible from the source tree.", undefined, 7)] },
	];
	const extraTurns = options.extraTurns ?? 0;
	for (let index = 0; index < extraTurns; index += 1) {
		turns.push({
			add: [assistantMessage(`Follow-up read ${index + 1}: no new failures.`, undefined, 8 + index)],
		});
	}
	return { name: extraTurns > 0 ? "heavy-long" : "heavy", source: "synthetic", turns };
}

export function loadWorkload(name: string): Workload {
	if (name === "heavy") return heavyToolRun();
	if (name === "heavy-long") return heavyToolRun({ extraTurns: 12 });
	if (name === "assaultcube") return assaultCubeTrace();
	return loadTrace(resolve(name));
}

export function listWorkloads(): string[] {
	return ["assaultcube", "heavy", "heavy-long"];
}
