import { describe, expect, it } from "vitest";
import {
	CONTEXT_BUDGET_ENV,
	DEFAULT_IMAGE_TTL,
	DEFAULT_TOOL_OUTPUT_CAP,
	resolveContextBudget,
} from "../src/core/context-budget.js";

describe("resolveContextBudget", () => {
	it("defaults to disabled with the documented caps", () => {
		const budget = resolveContextBudget({}, {});
		expect(budget.toolOutputCap.enabled).toBe(false);
		expect(budget.toolOutputCap.options).toEqual({
			maxLines: DEFAULT_TOOL_OUTPUT_CAP.maxLines,
			maxBytes: DEFAULT_TOOL_OUTPUT_CAP.maxBytes,
			headRatio: DEFAULT_TOOL_OUTPUT_CAP.headRatio,
		});
		expect(budget.imageTtl).toEqual({
			enabled: false,
			options: { ttlTurns: DEFAULT_IMAGE_TTL.ttlTurns, paybackTurns: DEFAULT_IMAGE_TTL.paybackTurns },
		});
	});

	it("reads settings", () => {
		const budget = resolveContextBudget(
			{
				toolOutputCap: { enabled: true, maxLines: 40, maxBytes: 1500, headRatio: 0.4 },
				imageTtl: { enabled: true, ttlTurns: 1, paybackTurns: 4 },
			},
			{},
		);
		expect(budget.toolOutputCap).toEqual({
			enabled: true,
			options: { maxLines: 40, maxBytes: 1500, headRatio: 0.4 },
		});
		expect(budget.imageTtl).toEqual({ enabled: true, options: { ttlTurns: 1, paybackTurns: 4 } });
	});

	it("lets the environment override settings", () => {
		const env = {
			[CONTEXT_BUDGET_ENV.toolOutputCapEnabled]: "1",
			[CONTEXT_BUDGET_ENV.toolOutputCapMaxLines]: "77",
			[CONTEXT_BUDGET_ENV.toolOutputCapMaxBytes]: "9999",
			[CONTEXT_BUDGET_ENV.toolOutputCapHeadRatio]: "0.25",
			[CONTEXT_BUDGET_ENV.imageTtlEnabled]: "true",
			[CONTEXT_BUDGET_ENV.imageTtlTurns]: "0",
			[CONTEXT_BUDGET_ENV.imageTtlPaybackTurns]: "5",
		};
		const budget = resolveContextBudget(
			{
				toolOutputCap: { enabled: false, maxLines: 40 },
				imageTtl: { enabled: false, ttlTurns: 5, paybackTurns: 9 },
			},
			env,
		);
		expect(budget.toolOutputCap).toEqual({
			enabled: true,
			options: { maxLines: 77, maxBytes: 9999, headRatio: 0.25 },
		});
		expect(budget.imageTtl).toEqual({ enabled: true, options: { ttlTurns: 0, paybackTurns: 5 } });
	});

	it.each([
		["a non-numeric line cap", CONTEXT_BUDGET_ENV.toolOutputCapMaxLines, "abc", DEFAULT_TOOL_OUTPUT_CAP.maxLines],
		["a zero line cap", CONTEXT_BUDGET_ENV.toolOutputCapMaxLines, "0", DEFAULT_TOOL_OUTPUT_CAP.maxLines],
		["a ratio above one", CONTEXT_BUDGET_ENV.toolOutputCapHeadRatio, "1.5", DEFAULT_TOOL_OUTPUT_CAP.headRatio],
		["a negative TTL", CONTEXT_BUDGET_ENV.imageTtlTurns, "-2", DEFAULT_IMAGE_TTL.ttlTurns],
	])("falls back on %s", (_label, envName, value, expected) => {
		const budget = resolveContextBudget({}, { [envName]: value });
		const actual =
			envName === CONTEXT_BUDGET_ENV.toolOutputCapMaxLines
				? budget.toolOutputCap.options.maxLines
				: envName === CONTEXT_BUDGET_ENV.toolOutputCapHeadRatio
					? budget.toolOutputCap.options.headRatio
					: budget.imageTtl.options.ttlTurns;
		expect(actual).toBe(expected);
	});

	it("falls back on a zero payback window", () => {
		const budget = resolveContextBudget({}, { [CONTEXT_BUDGET_ENV.imageTtlPaybackTurns]: "0" });
		expect(budget.imageTtl.options.paybackTurns).toBe(DEFAULT_IMAGE_TTL.paybackTurns);
	});
});
