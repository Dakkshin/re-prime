import { describe, expect, it } from "vitest";
import {
	classifyJevError,
	createJevStopGate,
	createZeroArgReflexRouter,
	DEFAULT_JEV_MIN_CONFIDENCE,
	evaluateJevDecision,
	type JevClassifier,
	type JevDecision,
	type JevErrorCategory,
	type JevGateOptions,
	type JevStopDecider,
} from "../src/jev.js";

const OPTIONS: JevGateOptions = { minConfidence: DEFAULT_JEV_MIN_CONFIDENCE, allowedTools: ["bash", "edit"] };

describe("evaluateJevDecision", () => {
	it.each<[string, JevDecision | undefined]>([
		["no decision", undefined],
		["uncertain action", { action: "UNCERTAIN", confidence: 0.99 }],
		["confidence below floor", { action: "STOP", confidence: 0.1 }],
		["non-finite confidence", { action: "STOP", confidence: Number.NaN }],
		["execute without tool name", { action: "EXECUTE_TOOL", confidence: 0.99 }],
		["execute with unknown tool", { action: "EXECUTE_TOOL", toolName: "rm", confidence: 0.99 }],
	])("rejects %s", (_label, decision) => {
		expect(evaluateJevDecision(decision, OPTIONS)).toBeUndefined();
	});

	it.each<[string, JevDecision]>([
		["stop", { action: "STOP", confidence: DEFAULT_JEV_MIN_CONFIDENCE }],
		["delegate", { action: "DELEGATE", confidence: 0.9 }],
		["execute an allowed tool", { action: "EXECUTE_TOOL", toolName: "bash", confidence: 0.92 }],
	])("accepts %s at or above the floor", (_label, decision) => {
		expect(evaluateJevDecision(decision, OPTIONS)).toBe(decision);
	});
});

describe("classifyJevError", () => {
	it.each<[string, string | undefined, JevErrorCategory]>([
		["a missing error", undefined, "NONE"],
		["a socket timeout", "connect ETIMEDOUT 10.0.0.1:5432", "TRANSIENT"],
		["a rate limit", "429 Too Many Requests", "TRANSIENT"],
		["a name error", "NameError: name 'x' is not defined", "DETERMINISTIC"],
		["a missing file", "bash: jq: command not found", "DETERMINISTIC"],
		["an unrecognized error", "kernel restarted", "NONE"],
	])("reads %s as %s", (_label, error, expected) => {
		expect(classifyJevError(error)).toBe(expected);
	});
});

describe("evaluateJevDecision entropy path", () => {
	const options: JevGateOptions = { ...OPTIONS, minProbability: 0.7, maxEntropy: 0.6 };
	const decision: JevDecision = {
		action: "EXECUTE_TOOL",
		toolName: "bash",
		confidence: 0.6,
		entropy: 0.3,
		topProbability: 0.9,
	};

	it("accepts a concentrated low-confidence decision", () => {
		expect(evaluateJevDecision(decision, options)).toBe(decision);
	});

	it.each<[string, JevDecision]>([
		["a diffuse distribution", { ...decision, entropy: 1.2 }],
		["a weak top probability", { ...decision, topProbability: 0.5 }],
		["a missing entropy", { ...decision, entropy: undefined }],
	])("rejects %s", (_label, value) => {
		expect(evaluateJevDecision(value, options)).toBeUndefined();
	});
});

describe("createJevStopGate", () => {
	const decider =
		(value: JevDecision | undefined): JevStopDecider =>
		async () =>
			value;
	const state = { turnIndex: 0, consecutiveFailures: 0 };

	it("stops on a gated stop decision", async () => {
		const gate = createJevStopGate(decider({ action: "STOP", confidence: 0.9 }), OPTIONS);
		await expect(gate(state)).resolves.toBe(true);
	});

	it.each<[string, JevStopDecider]>([
		["a continue decision", decider({ action: "UNCERTAIN", confidence: 0.99 })],
		["a low-confidence stop", decider({ action: "STOP", confidence: 0.2 })],
		["a tool decision", decider({ action: "EXECUTE_TOOL", toolName: "bash", confidence: 0.99 })],
		["no decision", decider(undefined)],
		[
			"a thrown error",
			(async () => {
				throw new Error("down");
			}) as JevStopDecider,
		],
	])("continues for %s", async (_label, value) => {
		await expect(createJevStopGate(value, OPTIONS)(state)).resolves.toBe(false);
	});
});

describe("createZeroArgReflexRouter", () => {
	const classifier =
		(value: JevDecision | undefined): JevClassifier =>
		async () =>
			value;
	const context = { turnIndex: 0, consecutiveReflexes: 0, context: { systemPrompt: "", messages: [] } };

	it("maps an allow-listed tool choice to a zero-argument reflex", async () => {
		const router = createZeroArgReflexRouter(
			classifier({ action: "EXECUTE_TOOL", toolName: "bash", confidence: 0.9 }),
			OPTIONS,
		);
		await expect(router(context)).resolves.toEqual({ toolName: "bash", arguments: {} });
	});

	it.each<[string, JevClassifier]>([
		["a disallowed tool", classifier({ action: "EXECUTE_TOOL", toolName: "rm", confidence: 0.9 })],
		["a low-confidence tool", classifier({ action: "EXECUTE_TOOL", toolName: "bash", confidence: 0.1 })],
		["a stop decision", classifier({ action: "STOP", confidence: 0.99 })],
		["no decision", classifier(undefined)],
	])("defers for %s", async (_label, value) => {
		await expect(createZeroArgReflexRouter(value, OPTIONS)(context)).resolves.toBeUndefined();
	});
});
