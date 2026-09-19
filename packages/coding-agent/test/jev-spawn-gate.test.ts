import type { JevDecision } from "@earendil-works/pi-agent-core";
import { describe, expect, it, vi } from "vitest";
import {
	assertDelegationAllowed,
	createJevSpawnGate,
	isJevSpawnGateEnabled,
	JEV_DELEGATE_CHOICE,
	JEV_INLINE_CHOICE,
	JEV_REJECT_CHOICE,
	JEV_SPAWN_GATE_ENV,
	verdictForDecision,
} from "../src/core/jev-spawn-gate.js";

function toolDecision(toolName: string, confidence: number, extra: Partial<JevDecision> = {}): JevDecision {
	return { action: "EXECUTE_TOOL", toolName, confidence, ...extra };
}

describe("isJevSpawnGateEnabled", () => {
	it.each<[string | undefined, boolean]>([
		[undefined, false],
		["0", false],
		["no", false],
		["1", true],
		["true", true],
		["YES", true],
	])("maps %s to %s", (raw, expected) => {
		const env = raw === undefined ? {} : { [JEV_SPAWN_GATE_ENV]: raw };
		expect(isJevSpawnGateEnabled(env)).toBe(expected);
	});
});

describe("verdictForDecision", () => {
	it.each<[string, JevDecision | undefined, string]>([
		["delegate choice", toolDecision(JEV_DELEGATE_CHOICE, 0.99), "delegate"],
		["inline choice", toolDecision(JEV_INLINE_CHOICE, 0.99), "inline"],
		["redundant choice", toolDecision(JEV_REJECT_CHOICE, 0.99), "redundant"],
		["unknown tool", toolDecision("write_file", 0.99), "unknown"],
		["no decision", undefined, "unknown"],
		["non-execute action", { action: "STOP", confidence: 0.99 }, "unknown"],
	])("maps %s", (_label, decision, expected) => {
		expect(verdictForDecision(decision)).toBe(expected);
	});
});

describe("assertDelegationAllowed", () => {
	it("throws for inline and redundant verdicts", () => {
		expect(() => assertDelegationAllowed("inline")).toThrow("DELEGATION_REJECTED");
		expect(() => assertDelegationAllowed("redundant")).toThrow("DELEGATION_REJECTED");
	});

	it("allows delegate and unknown verdicts", () => {
		expect(() => assertDelegationAllowed("delegate")).not.toThrow();
		expect(() => assertDelegationAllowed("unknown")).not.toThrow();
	});
});

describe("createJevSpawnGate", () => {
	it.each<[string, JevDecision | undefined, string]>([
		["a sure delegate", toolDecision(JEV_DELEGATE_CHOICE, 0.95), "delegate"],
		["a sure inline", toolDecision(JEV_INLINE_CHOICE, 0.95), "inline"],
		[
			"a concentrated entropy signal",
			toolDecision(JEV_INLINE_CHOICE, 0.5, { topProbability: 0.9, entropy: 0.1 }),
			"inline",
		],
		["a sub-floor signal", toolDecision(JEV_INLINE_CHOICE, 0.4), "unknown"],
		["an uncertain verdict", { action: "UNCERTAIN", confidence: 0.99 }, "unknown"],
		["no decision", undefined, "unknown"],
	])("resolves %s to %s", async (_label, decision, expected) => {
		const gate = createJevSpawnGate({ classifier: async () => decision });
		await expect(gate("parent goal", "child task")).resolves.toBe(expected);
	});

	it("fails open when the classifier throws", async () => {
		const gate = createJevSpawnGate({
			classifier: async () => {
				throw new Error("transport down");
			},
		});
		await expect(gate("parent goal", "child task")).resolves.toBe("unknown");
	});

	it("passes the parent goal and the prospective task to the classifier", async () => {
		const classifier = vi.fn(async () => toolDecision(JEV_DELEGATE_CHOICE, 0.95));
		const gate = createJevSpawnGate({ classifier });
		await gate("ship the feature", "read the config");
		expect(classifier).toHaveBeenCalledWith(
			expect.objectContaining({
				goal: "ship the feature",
				lastToolName: "rlm.spawn",
				lastAssistantText: expect.stringContaining("read the config"),
			}),
		);
	});
});
