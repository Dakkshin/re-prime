import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ImageContent, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
	countResidentImages,
	evictStaleImages,
	IMAGE_TOKEN_COST,
	IMAGE_TTL_PAYBACK_TURNS,
	imageEvictionPlaceholder,
	planImageEviction,
} from "../src/core/image-ttl.js";

const IMAGE: ImageContent = { type: "image", data: "AAAA", mimeType: "image/png" };
const LATER_IMAGE: ImageContent = { type: "image", data: "BBBB", mimeType: "image/jpeg" };

function textUser(text: string): UserMessage {
	return { role: "user", content: text, timestamp: 0 };
}

function userWithImage(image: ImageContent = IMAGE): UserMessage {
	return { role: "user", content: [image], timestamp: 0 };
}

function toolResultWithImage(toolName: string, image: ImageContent = IMAGE): ToolResultMessage {
	return { role: "toolResult", toolCallId: "c1", toolName, content: [image], isError: false, timestamp: 0 };
}

function assistant(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-completions",
		provider: "openai",
		model: "test",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 0,
	};
}

describe("imageEvictionPlaceholder", () => {
	it("includes the observation when present", () => {
		expect(imageEvictionPlaceholder("image/png")).toBe("[image evicted: image/png]");
		expect(imageEvictionPlaceholder("image/png", "bash")).toBe("[image evicted: image/png; observed: bash]");
	});
});

describe("evictStaleImages", () => {
	it("is a passthrough when disabled", () => {
		const messages: AgentMessage[] = [userWithImage(), assistant("a"), assistant("b"), assistant("c")];
		expect(evictStaleImages(messages, { ttlTurns: 0 })).toBe(messages);
	});

	it("returns the original array when nothing is stale", () => {
		const messages: AgentMessage[] = [userWithImage(), assistant("a")];
		expect(evictStaleImages(messages, { ttlTurns: 3 })).toBe(messages);
	});

	it("evicts images older than the TTL and keeps fresher ones", () => {
		const messages: AgentMessage[] = [
			userWithImage(IMAGE),
			assistant("a"),
			assistant("b"),
			assistant("c"),
			toolResultWithImage("bash", LATER_IMAGE),
		];
		const result = evictStaleImages(messages, { ttlTurns: 2 });
		expect(result[0].role).toBe("user");
		const oldContent = result[0].role === "user" ? result[0].content : [];
		expect(oldContent).toEqual([{ type: "text", text: imageEvictionPlaceholder("image/png") }]);
		const recent = result[4];
		expect(recent.role === "toolResult" && recent.content[0]).toEqual(LATER_IMAGE);
	});

	it("notes the originating tool for evicted tool-result images", () => {
		const messages: AgentMessage[] = [toolResultWithImage("bash"), assistant("a"), assistant("b"), assistant("c")];
		const result = evictStaleImages(messages, { ttlTurns: 2 });
		const content = result[0].role === "toolResult" ? result[0].content : [];
		expect(content).toEqual([{ type: "text", text: "[image evicted: image/png; observed: bash]" }]);
	});

	it("never mutates the input transcript", () => {
		const original = userWithImage();
		const messages: AgentMessage[] = [original, assistant("a"), assistant("b"), assistant("c")];
		evictStaleImages(messages, { ttlTurns: 1 });
		expect(messages[0]).toBe(original);
		expect(original.content).toEqual([IMAGE]);
	});
});

describe("countResidentImages", () => {
	it("counts images across user and tool-result messages", () => {
		expect(countResidentImages([userWithImage(), assistant("a"), toolResultWithImage("bash", LATER_IMAGE)])).toBe(2);
	});
});

describe("planImageEviction", () => {
	it("is a passthrough when disabled", () => {
		const messages: AgentMessage[] = [userWithImage(), assistant("a"), assistant("b"), assistant("c")];
		const plan = planImageEviction(messages, { ttlTurns: 0 });
		expect(plan.evicted).toBe(false);
		expect(plan.messages).toBe(messages);
	});

	it("approves an eviction that repays the break on the same turn", () => {
		const messages: AgentMessage[] = [userWithImage(), assistant("a"), assistant("b"), assistant("c")];
		const plan = planImageEviction(messages, { ttlTurns: 2 });
		expect(plan.evicted).toBe(true);
		expect(plan.evictedImages).toBe(1);
		expect(plan.breakTokens).toBe(0);
		expect(plan.paybackTurns).toBe(0);
		expect(plan.messages).toEqual(evictStaleImages(messages, { ttlTurns: 2 }));
	});

	it.each([
		["a resident prefix", 40_000],
		["a large resident prefix", 400_000],
	])("defers the eviction when %s makes the payback exceed the window", (_label, chars) => {
		const messages: AgentMessage[] = [
			textUser("x".repeat(chars)),
			userWithImage(),
			assistant("a"),
			assistant("b"),
			assistant("c"),
		];
		const plan = planImageEviction(messages, { ttlTurns: 2 });
		expect(plan.evicted).toBe(false);
		expect(plan.messages).toBe(messages);
		expect(plan.recoveredTokens).toBeGreaterThan(0);
		expect(plan.paybackTurns).toBeGreaterThan(IMAGE_TTL_PAYBACK_TURNS);
	});

	it("honors an explicit payback window", () => {
		const messages: AgentMessage[] = [
			textUser("x".repeat(4_000)),
			userWithImage(),
			assistant("a"),
			assistant("b"),
			assistant("c"),
		];
		const plan = planImageEviction(messages, { ttlTurns: 2, paybackTurns: 100 });
		expect(plan.evicted).toBe(true);
		expect(plan.breakTokens).toBe(1_000);
	});

	it("prices the recovered tokens at the flat per-image cost", () => {
		const messages: AgentMessage[] = [userWithImage(), assistant("a"), assistant("b"), assistant("c")];
		const plan = planImageEviction(messages, { ttlTurns: 2 });
		expect(plan.recoveredTokens).toBeLessThanOrEqual(IMAGE_TOKEN_COST);
		expect(plan.recoveredTokens).toBeGreaterThan(IMAGE_TOKEN_COST - 64);
	});
});
