import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { estimateContextTokens } from "../src/core/compaction/index.js";
import {
	contentByteSize,
	createContextStatsAccumulator,
	estimateBase64Bytes,
	formatContextStatsLine,
	utf8Bytes,
} from "../src/core/context-stats.js";

function usage(partial: Partial<Usage> = {}): Usage {
	return {
		input: 100,
		output: 20,
		cacheRead: 50,
		cacheWrite: 5,
		totalTokens: 175,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		...partial,
	};
}

function assistant(messageUsage: Usage): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "done" }],
		api: "openai-completions",
		provider: "openai",
		model: "test",
		usage: messageUsage,
		stopReason: "stop",
		timestamp: 0,
	};
}

describe("utf8Bytes", () => {
	it("counts multibyte characters as their utf8 length", () => {
		expect(utf8Bytes("abc")).toBe(3);
		expect(utf8Bytes("é")).toBe(2);
		expect(utf8Bytes("")).toBe(0);
	});
});

describe("estimateBase64Bytes", () => {
	it.each([
		["", 0],
		["AAAA", 3],
		["AAA=", 2],
		["AA==", 1],
	])("decodes %j to %i bytes", (data, expected) => {
		expect(estimateBase64Bytes(data)).toBe(expected);
	});
});

describe("contentByteSize", () => {
	it("sums text and decoded image bytes, tracking image bytes separately", () => {
		const size = contentByteSize([
			{ type: "text", text: "é" },
			{ type: "image", data: "AAAA", mimeType: "image/png" },
		]);
		expect(size).toEqual({ total: 5, image: 3 });
	});
});

describe("createContextStatsAccumulator", () => {
	it("accumulates tool-result bytes and cap/eviction counts until reset", () => {
		const accumulator = createContextStatsAccumulator();
		accumulator.observeToolResult([{ type: "text", text: "abcd" }], true);
		accumulator.observeToolResult([{ type: "image", data: "AAAA", mimeType: "image/png" }], false);
		accumulator.observeEviction(2);
		accumulator.observeJanitor(4);

		const stats = accumulator.snapshot({ turnIndex: 1, usage: usage(), messages: [assistant(usage())] });
		expect(stats.toolResultBytes).toBe(7);
		expect(stats.imageBytes).toBe(3);
		expect(stats.toolResultsCapped).toBe(1);
		expect(stats.imagesEvicted).toBe(2);
		expect(stats.janitorCompressedMessages).toBe(4);

		accumulator.reset();
		const afterReset = accumulator.snapshot({ turnIndex: 4, usage: usage(), messages: [assistant(usage())] });
		expect(afterReset.toolResultBytes).toBe(0);
		expect(afterReset.imagesEvicted).toBe(0);
		expect(afterReset.janitorCompressedMessages).toBe(0);
	});

	it("reports usage and context tokens from the message transcript", () => {
		const accumulator = createContextStatsAccumulator();
		const messages = [assistant(usage({ input: 7, output: 3 }))];
		const stats = accumulator.snapshot({ turnIndex: 9, usage: usage({ input: 7, output: 3 }), messages });
		expect(stats.turnIndex).toBe(9);
		expect(stats.inputTokens).toBe(7);
		expect(stats.outputTokens).toBe(3);
		expect(stats.estimatedContextTokens).toBe(estimateContextTokens(messages).tokens);
	});
});

describe("formatContextStatsLine", () => {
	it("renders a stable single line", () => {
		const line = formatContextStatsLine({
			turnIndex: 3,
			inputTokens: 1200,
			outputTokens: 340,
			cacheReadTokens: 45000,
			cacheWriteTokens: 800,
			toolResultBytes: 15234,
			imageBytes: 204800,
			estimatedContextTokens: 21000,
			toolResultsCapped: 2,
			imagesEvicted: 1,
			janitorCompressedMessages: 5,
		});
		expect(line).toBe(
			"turn=3 input=1200 output=340 cacheRead=45000 cacheWrite=800 toolResultBytes=15234 imageBytes=204800 estContext=21000 capped=2 evicted=1 janitor=5",
		);
	});
});
