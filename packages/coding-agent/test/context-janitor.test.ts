import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, Usage, UserMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { CONTEXT_JANITOR_DEFAULTS, planContextJanitor } from "../src/core/context-janitor.js";

const USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** Live usage on the newest assistant turn, so the context estimate is non-zero. */
const LIVE_USAGE: Usage = {
	...USAGE,
	input: 12_000,
	output: 250,
	totalTokens: 12_250,
};

function user(text: string): UserMessage {
	return { role: "user", content: text, timestamp: 0 };
}

function assistantCall(id: string, name: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id, name, arguments: {} }],
		api: "test",
		provider: "test",
		model: "test",
		usage: USAGE,
		stopReason: "toolUse",
		timestamp: 0,
	};
}

function assistantText(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "test",
		provider: "test",
		model: "test",
		usage: LIVE_USAGE,
		stopReason: "stop",
		timestamp: 0,
	};
}

function toolResult(id: string, toolName: string, text: string, isError: boolean): ToolResultMessage {
	return { role: "toolResult", toolCallId: id, toolName, content: [{ type: "text", text }], isError, timestamp: 0 };
}

const FAILED_BUILD = "server.cpp:14:10: fatal error: SDL.h: No such file or directory";
const FAILED_PTRACE = "ptrace: Operation not permitted. Cannot attach to process: ptrace_scope is 1.";

/** Two failed bash attempts, then a success, then the active-window assistant turn. */
function supersededFailures(): AgentMessage[] {
	return [
		user("build the server"),
		assistantCall("c1", "bash"),
		toolResult("c1", "bash", FAILED_BUILD, true),
		assistantCall("c2", "bash"),
		toolResult("c2", "bash", FAILED_PTRACE, true),
		assistantCall("c3", "bash"),
		toolResult("c3", "bash", "server started on UDP 28785", false),
		assistantText("The build now works."),
	];
}

const BASE = { minTokens: 1, minTurns: 1, turnIndex: 20, lastPruneTurn: 0, activeWindowTurns: 1 } as const;

describe("planContextJanitor", () => {
	it("stays closed until the minimum turn gap has elapsed", () => {
		const messages = supersededFailures();
		const plan = planContextJanitor(messages, { ...BASE, turnIndex: 5, lastPruneTurn: 0, minTurns: 15 });
		expect(plan.changed).toBe(false);
		expect(plan.messages).toBe(messages);
	});

	it("stays closed under the token floor", () => {
		const plan = planContextJanitor(supersededFailures(), { ...BASE, minTokens: 10_000_000 });
		expect(plan.changed).toBe(false);
	});

	it("compresses superseded failures without dropping messages or reordering them", () => {
		const messages = supersededFailures();
		const plan = planContextJanitor(messages, BASE);
		expect(plan.changed).toBe(true);
		expect(plan.trajectoriesCompressed).toBe(1);
		expect(plan.messagesCompressed).toBe(2);
		expect(plan.messages).toHaveLength(messages.length);
		expect(plan.messages[2].role).toBe("toolResult");
		expect(plan.messages[4].role).toBe("toolResult");

		const first = (plan.messages[2] as ToolResultMessage).content[0] as { text: string };
		const second = (plan.messages[4] as ToolResultMessage).content[0] as { text: string };
		expect(first.text).toContain("Historical execution compressed: 2 failed bash attempts");
		expect(first.text).toContain("superseded by a successful bash call");
		expect(second.text).toBe("[compressed: failed bash attempt]");

		// Pairing and flags survive: the assistant calls and error marks are intact.
		expect((plan.messages[3] as AssistantMessage).content[0]).toMatchObject({ type: "toolCall", name: "bash" });
		expect((plan.messages[2] as ToolResultMessage).isError).toBe(true);
		expect((plan.messages[2] as ToolResultMessage).toolCallId).toBe("c1");
	});

	it("leaves an unsuperseded failure trajectory untouched", () => {
		const messages = supersededFailures();
		messages[6] = assistantText("Still failing; I will keep digging.");
		const plan = planContextJanitor(messages, BASE);
		expect(plan.changed).toBe(false);
	});

	it("protects the active window", () => {
		const messages = supersededFailures();
		const plan = planContextJanitor(messages, {
			...BASE,
			activeWindowTurns: CONTEXT_JANITOR_DEFAULTS.activeWindowTurns,
		});
		expect(plan.changed).toBe(false);
	});

	it("is deterministic across repeated plans", () => {
		const first = planContextJanitor(supersededFailures(), BASE);
		const second = planContextJanitor(supersededFailures(), BASE);
		expect(JSON.stringify(first.messages)).toBe(JSON.stringify(second.messages));
		expect(second.estimatedTokensAfter).toBe(first.estimatedTokensAfter);
	});
});
