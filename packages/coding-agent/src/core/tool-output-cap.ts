import { Buffer } from "node:buffer";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { truncateHead, truncateTail } from "./tools/truncate.js";

export interface ToolOutputCapOptions {
	/** Maximum text lines kept inline. */
	maxLines: number;
	/** Maximum text bytes kept inline. */
	maxBytes: number;
	/** Fraction of the budget reserved for the head, in [0, 1]. */
	headRatio: number;
}

export interface CapToolOutputInput {
	content: (TextContent | ImageContent)[];
	/** Pointer from a tool that already spilled output (e.g. bash fullOutputPath). */
	existingFullOutputPath?: string;
	options: ToolOutputCapOptions;
	/** Writes the full output and returns an absolute path. Injected for testing. */
	writeScratchpad: (text: string) => string;
}

export interface CappedToolOutput {
	content: (TextContent | ImageContent)[];
	capped: boolean;
	fullOutputPath?: string;
	originalBytes: number;
}

export interface ScratchpadWriterOptions {
	dir: string;
	randomSuffix?: () => string;
}

const BEYOND_POINTER_OMITTED = "[... middle omitted; see full output file ...]";

function utf8Bytes(text: string): number {
	return Buffer.byteLength(text, "utf8");
}

export function exceedsOutputCap(text: string, options: ToolOutputCapOptions): boolean {
	return utf8Bytes(text) > options.maxBytes || text.split("\n").length > options.maxLines;
}

function buildPointer(
	fullOutputPath: string,
	totalLines: number,
	totalBytes: number,
	options: ToolOutputCapOptions,
): string {
	return [
		`[Output exceeded ${options.maxLines} lines / ${options.maxBytes} bytes (${totalLines} lines, ${totalBytes} bytes).]`,
		`[Full output: ${fullOutputPath}]`,
		"[Use grep/awk/sed on that file to inspect specific sections.]",
	].join("\n");
}

/**
 * Bounds a tool result to a head+tail window and points the model at the full
 * output on disk. Text is capped; images pass through untouched.
 *
 * Fail-open: any error returns the original content uncapped.
 */
export function capToolOutput(input: CapToolOutputInput): CappedToolOutput {
	const { content, existingFullOutputPath, options, writeScratchpad } = input;
	try {
		const textParts = content.filter((part): part is TextContent => part.type === "text");
		const restParts = content.filter((part) => part.type !== "text");
		const imageBytes = restParts.reduce(
			(sum, part) => (part.type === "image" ? sum + Math.floor((part.data.length * 3) / 4) : sum),
			0,
		);
		const text = textParts.map((part) => part.text).join("\n");
		const originalBytes = utf8Bytes(text) + imageBytes;

		if (!exceedsOutputCap(text, options)) {
			return { content, capped: false, originalBytes };
		}

		const fullOutputPath = existingFullOutputPath ?? writeScratchpad(text);
		const totalLines = text.split("\n").length;
		const totalBytes = utf8Bytes(text);
		const headLines = Math.max(1, Math.floor(options.maxLines * options.headRatio));
		const tailLines = Math.max(0, options.maxLines - headLines);
		const head = truncateHead(text, {
			maxLines: headLines,
			maxBytes: Math.max(1, Math.ceil(options.maxBytes * options.headRatio)),
		});
		const tail = tailLines > 0 ? truncateTail(text, { maxLines: tailLines, maxBytes: options.maxBytes }) : undefined;

		const sections = [head.content, tail?.content].filter((section): section is string => Boolean(section));
		const windowed = sections.join(`\n${BEYOND_POINTER_OMITTED}\n`);
		const pointer = buildPointer(fullOutputPath, totalLines, totalBytes, options);
		const bounded: TextContent = { type: "text", text: windowed.length > 0 ? `${windowed}\n${pointer}` : pointer };

		return {
			content: [bounded, ...restParts],
			capped: true,
			fullOutputPath,
			originalBytes,
		};
	} catch {
		return { content, capped: false, originalBytes: 0 };
	}
}

/** Creates a writer that stores full outputs under a session scratchpad directory. */
export function createScratchpadWriter(options: ScratchpadWriterOptions): (text: string) => string {
	const randomSuffix = options.randomSuffix ?? (() => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
	return (text) => {
		mkdirSync(options.dir, { recursive: true });
		const path = join(options.dir, `tool-output-${randomSuffix()}.txt`);
		writeFileSync(path, text, { encoding: "utf8", mode: 0o600 });
		return path;
	};
}
