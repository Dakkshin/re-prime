import type { AgentMessage, JevClassifier, JevDecision, PreTurnRouterContext } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import {
	buildJevState,
	createJevPreTurnRouter,
	deriveLastToolCall,
	isJevRouterEnabled,
	isJevStopEnabled,
	JEV_RETRY_CHOICE,
} from "../src/core/jev-router.js";

function assistantToolCall(name: string, args: Record<string, unknown>, text?: string): AgentMessage {
	return {
		role: "assistant",
		content: [
			...(text ? [{ type: "text" as const, text }] : []),
			{ type: "toolCall", id: "call-1", name, arguments: args },
		],
		api: "openai-responses",
		provider: "openai",
		model: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: 1,
	};
}

function toolResult(name: string, isError: boolean, text: string): AgentMessage {
	return {
		role: "toolResult",
		toolCallId: "call-1",
		toolName: name,
		content: [{ type: "text", text }],
		isError,
		timestamp: 2,
	};
}

function userMessage(text: string): AgentMessage {
	return { role: "user", content: text, timestamp: 0 };
}

const classifier =
	(value: Awaited<ReturnType<JevClassifier>>): JevClassifier =>
	async () =>
		value;
const contextWith = (messages: AgentMessage[]): PreTurnRouterContext => ({
	turnIndex: 2,
	consecutiveReflexes: 0,
	context: { systemPrompt: "", messages },
});

describe("isJevRouterEnabled", () => {
	it.each([
		["1", true],
		["YES", true],
		["0", false],
		[undefined, false],
	])("reads %s as %s", (value, expected) => {
		expect(isJevRouterEnabled({ PRIME_AGENT_JEV_ENABLED: value })).toBe(expected);
	});
});

describe("isJevStopEnabled", () => {
	it.each([
		[{ PRIME_AGENT_JEV_ENABLED: "1", PRIME_AGENT_JEV_STOP: "1" }, true],
		[{ PRIME_AGENT_JEV_ENABLED: "1" }, false],
		[{ PRIME_AGENT_JEV_STOP: "1" }, false],
		[{}, false],
	])("reads %j as %s", (env, expected) => {
		expect(isJevStopEnabled(env)).toBe(expected);
	});
});

describe("buildJevState and deriveLastToolCall", () => {
	const messages = [assistantToolCall("ipython", { code: "print(1)" }), toolResult("ipython", false, "ok")];

	it("summarizes the last call and clears failures on success", () => {
		expect(buildJevState(messages, 3)).toEqual({
			turnIndex: 3,
			consecutiveFailures: 0,
			lastToolName: "ipython",
			lastToolResult: "ok",
			errorCategory: "NONE",
		});
		expect(deriveLastToolCall(messages)).toEqual({ toolName: "ipython", arguments: { code: "print(1)" } });
	});

	it("keeps the last assistant text", () => {
		const messages = [assistantToolCall("bash", {}, "All done"), toolResult("bash", false, "ok")];
		expect(buildJevState(messages, 0).lastAssistantText).toBe("All done");
	});

	it("counts consecutive failures and keeps the last error", () => {
		const state = buildJevState([toolResult("ipython", true, "boom"), toolResult("ipython", true, "again")], 0);
		expect(state.consecutiveFailures).toBe(2);
		expect(state.lastToolError).toBe("again");
		expect(deriveLastToolCall([toolResult("ipython", false, "ok")])).toBeUndefined();
	});

	it("adds the goal and a transient error category", () => {
		const error = "connect ETIMEDOUT 10.0.0.1:5432";
		const messages = [userMessage("fix the build"), toolResult("bash", true, error)];
		expect(buildJevState(messages, 1)).toEqual({
			turnIndex: 1,
			consecutiveFailures: 1,
			lastToolName: "bash",
			lastToolError: error,
			lastToolResult: error,
			goal: "fix the build",
			errorCategory: "TRANSIENT",
		});
	});
});

describe("createJevPreTurnRouter", () => {
	it("re-runs the last tool call for a retry choice", async () => {
		const tools = ["bash"];
		const classifierImpl = classifier({ action: "EXECUTE_TOOL", toolName: JEV_RETRY_CHOICE, confidence: 0.9 });
		const router = createJevPreTurnRouter({ tools, classifier: classifierImpl });
		const context = contextWith([assistantToolCall("ipython", { code: "print(1)" })]);
		await expect(router(context)).resolves.toEqual({ toolName: "ipython", arguments: { code: "print(1)" } });
	});

	it("re-runs a concentrated low-confidence retry", async () => {
		const decision: JevDecision = {
			action: "EXECUTE_TOOL",
			toolName: JEV_RETRY_CHOICE,
			confidence: 0.6,
			entropy: 0.3,
			topProbability: 0.9,
		};
		const router = createJevPreTurnRouter({ tools: ["bash"], classifier: classifier(decision) });
		const context = contextWith([assistantToolCall("ipython", { code: "print(1)" })]);
		await expect(router(context)).resolves.toEqual({ toolName: "ipython", arguments: { code: "print(1)" } });
	});

	it.each([
		["a disallowed tool", classifier({ action: "EXECUTE_TOOL", toolName: "nuke", confidence: 0.9 })],
		["a stop decision", classifier({ action: "STOP", confidence: 0.99 })],
		["no decision", classifier(undefined)],
	])("defers for %s", async (_label, value) => {
		const router = createJevPreTurnRouter({ tools: ["bash"], classifier: value });
		await expect(router(contextWith([assistantToolCall("ipython", {})]))).resolves.toBeUndefined();
	});
});
