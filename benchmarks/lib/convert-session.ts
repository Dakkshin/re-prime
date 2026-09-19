#!/usr/bin/env npx tsx
/**
 * Converts a recorded Prime Agent v3 session JSONL into the compact trace
 * schema the replay harness consumes, redacting local paths and secrets.
 *
 *   npx tsx benchmarks/lib/convert-session.ts <session.jsonl> [--out trace.jsonl]
 *
 * Only `message` entries are kept; compaction, model changes, and usage are
 * dropped because the replay prices a transcript itself. Messages carrying an
 * image are emitted as raw `AgentMessage` entries with the pixel data replaced
 * by a 1x1 placeholder (the image's token cost is flat, so the eviction plan is
 * preserved without committing a screenshot). Every other message becomes a
 * compact `{role, text, toolCall}` / `{role, toolName, isError, text}` entry.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { AgentMessage } from "../../packages/agent/src/index.js";
import type { AssistantMessage, ImageContent, TextContent, ToolResultMessage, UserMessage } from "../../packages/ai/src/index.js";

/** A 1x1 transparent PNG; stands in for any redacted screenshot. */
export const REDACTED_IMAGE_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const REDACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
	[/\/home\/[A-Za-z0-9._-]+/g, "/home/user"],
	[/\/Users\/[A-Za-z0-9._-]+/g, "/home/user"],
	[/\bdakkshin\b/gi, "user"],
	[/sk-[A-Za-z0-9_-]{20,}/g, "[redacted-secret]"],
	[/ghp_[A-Za-z0-9]{20,}/g, "[redacted-secret]"],
	[/github_pat_[A-Za-z0-9_]{20,}/g, "[redacted-secret]"],
	[/AKIA[0-9A-Z]{16}/g, "[redacted-secret]"],
	[/Bearer\s+[A-Za-z0-9._-]{20,}/g, "Bearer [redacted-secret]"],
];

export function redactText(text: string): string {
	let out = text;
	for (const [pattern, replacement] of REDACTIONS) {
		out = out.replace(pattern, replacement);
	}
	return out;
}

function redactValue(value: unknown): unknown {
	if (typeof value === "string") return redactText(value);
	if (Array.isArray(value)) return value.map(redactValue);
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value)) out[key] = redactValue(entry);
		return out;
	}
	return value;
}

function redactImage(part: ImageContent): ImageContent {
	return { type: "image", data: REDACTED_IMAGE_BASE64, mimeType: part.mimeType };
}

function hasImage(message: AgentMessage): boolean {
	return (
		(message.role === "user" || message.role === "toolResult") &&
		Array.isArray(message.content) &&
		message.content.some((part) => part.type === "image")
	);
}

function textOf(message: UserMessage | ToolResultMessage | AssistantMessage): string {
	const content = message.content;
	if (typeof content === "string") return content;
	return content
		.filter((part): part is TextContent => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

function rawEntry(message: AgentMessage): AgentMessage {
	if (message.role === "user") {
		const content = (message.content as (TextContent | ImageContent)[]).map((part) =>
			part.type === "image" ? redactImage(part) : { type: "text" as const, text: redactText(part.text) },
		);
		return { role: "user", content, timestamp: 0 };
	}
	if (message.role === "toolResult") {
		const content = (message.content as (TextContent | ImageContent)[]).map((part) =>
			part.type === "image" ? redactImage(part) : { type: "text" as const, text: redactText(part.text) },
		);
		return {
			role: "toolResult",
			toolCallId: message.toolCallId,
			toolName: message.toolName,
			content,
			isError: message.isError,
			timestamp: 0,
		};
	}
	throw new Error(`rawEntry only handles user/toolResult, got ${message.role}`);
}

type TraceEntry =
	| { role: "user"; text: string }
	| { role: "assistant"; text?: string; toolCall?: { name: string; arguments: Record<string, unknown> } }
	| { role: "toolResult"; toolName: string; toolCallId: string; text: string; isError?: boolean }
	| AgentMessage;

function toTraceEntry(message: AgentMessage): TraceEntry | undefined {
	if (hasImage(message)) return rawEntry(message);
	if (message.role === "user") {
		const text = redactText(textOf(message));
		return text ? { role: "user", text } : undefined;
	}
	if (message.role === "toolResult") {
		return {
			role: "toolResult",
			toolName: message.toolName,
			toolCallId: message.toolCallId,
			text: redactText(textOf(message)),
			...(message.isError ? { isError: true } : {}),
		};
	}
	if (message.role === "assistant") {
		const text = redactText(textOf(message));
		const toolCall = message.content.find((part) => part.type === "toolCall");
		if (!text && !toolCall) return undefined;
		return {
			role: "assistant",
			...(text ? { text } : {}),
			...(toolCall
				? {
						toolCall: {
							name: toolCall.name,
							arguments: redactValue(toolCall.arguments ?? {}) as Record<string, unknown>,
						},
					}
				: {}),
		};
	}
	return undefined;
}

interface SessionEntry {
	type?: string;
	message?: AgentMessage;
}

export function convertSession(sessionPath: string): string {
	const lines = readFileSync(sessionPath, "utf8")
		.split("\n")
		.filter((line) => line.trim().length > 0);
	const out: string[] = [];
	let turn = 0;
	for (const line of lines) {
		const entry = JSON.parse(line) as SessionEntry;
		if (entry.type !== "message" || !entry.message) continue;
		const converted = toTraceEntry(entry.message);
		if (!converted) continue;
		out.push(JSON.stringify({ turn, add: [converted] }));
		turn += 1;
	}
	return `${out.join("\n")}\n`;
}

function main(): void {
	const [input, ...rest] = process.argv.slice(2);
	if (!input) {
		console.error("Usage: npx tsx benchmarks/lib/convert-session.ts <session.jsonl> [--out trace.jsonl]");
		process.exit(1);
	}
	const outIndex = rest.indexOf("--out");
	const output = outIndex >= 0 ? rest[outIndex + 1] : `${input.replace(/\.jsonl$/, "")}-trace.jsonl`;
	const trace = convertSession(input);
	writeFileSync(output, trace);
	console.log(`wrote ${output} (${trace.length} bytes, ${trace.split("\n").filter(Boolean).length} turns)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main();
}
