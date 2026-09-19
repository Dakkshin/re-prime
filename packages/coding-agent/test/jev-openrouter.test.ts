import type { JevDecision, JevState } from "@earendil-works/pi-agent-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createOpenRouterJevClassifier,
	DEFAULT_OPENROUTER_JEV_MODEL,
	type JevChoiceAnswer,
	type JevFetch,
	parseJevChoiceAnswer,
	toJevDecision,
} from "../src/core/jev-openrouter.js";

const STATE: JevState = { turnIndex: 0, consecutiveFailures: 0 };
const TOOLS = ["bash", "edit"] as const;
const answerFetch =
	(action: unknown, ok = true): JevFetch =>
	async () => ({
		ok,
		json: async () => ({ answers: { action } }),
	});

describe("parseJevChoiceAnswer", () => {
	it.each([
		["a non-choice answer", { answers: { action: { type: "noul", noul: 0.5 } } }],
		["a non-string choice", { answers: { action: { type: "choice", choice: 7 } } }],
		["a non-object payload", "nope"],
	])("rejects %s", (_label, payload) => {
		expect(parseJevChoiceAnswer(payload)).toBeUndefined();
	});

	it("reads choice, confidence and probabilities", () => {
		const payload = {
			answers: { action: { type: "choice", choice: "bash", confidence: 0.9, probabilities: { bash: 0.9 } } },
		};
		expect(parseJevChoiceAnswer(payload)).toEqual({ choice: "bash", confidence: 0.9, probabilities: { bash: 0.9 } });
	});
});

describe("toJevDecision", () => {
	it.each<[string, JevChoiceAnswer, JevDecision | undefined]>([
		[
			"a tool choice",
			{ choice: "bash", confidence: 0.9 },
			{ action: "EXECUTE_TOOL", toolName: "bash", confidence: 0.9 },
		],
		["stop", { choice: "stop", confidence: 0.8 }, { action: "STOP", confidence: 0.8 }],
		["uncertain", { choice: "uncertain", confidence: 0.7 }, { action: "UNCERTAIN", confidence: 0.7 }],
		["an unknown choice", { choice: "nuke", confidence: 0.9 }, undefined],
		["no confidence signal", { choice: "bash" }, undefined],
	])("maps %s", (_label, value, expected) => {
		expect(toJevDecision(value, TOOLS)).toEqual(expected);
	});
});

describe("createOpenRouterJevClassifier", () => {
	it("defers without an API key and never calls the network", async () => {
		const fetchImpl = vi.fn<JevFetch>();
		const classify = createOpenRouterJevClassifier({ apiKey: "", tools: TOOLS, fetch: fetchImpl });
		await expect(classify(STATE)).resolves.toBeUndefined();
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it.each([
		[
			"a valid answer",
			answerFetch({ type: "choice", choice: "bash", confidence: 0.91 }),
			{ action: "EXECUTE_TOOL", toolName: "bash", confidence: 0.91 },
		],
		["a non-2xx response", answerFetch({ type: "choice", choice: "bash", confidence: 0.91 }, false), undefined],
		["an unknown choice", answerFetch({ type: "choice", choice: "nuke", confidence: 0.91 }), undefined],
		["a malformed answer", answerFetch({ type: "choice" }), undefined],
		[
			"a transport failure",
			(async () => {
				throw new Error("down");
			}) as JevFetch,
			undefined,
		],
	])("handles %s", async (_label, fetchImpl, expected) => {
		const classify = createOpenRouterJevClassifier({ apiKey: "key", tools: TOOLS, fetch: fetchImpl });
		await expect(classify(STATE)).resolves.toEqual(expected);
	});

	it("targets the decisions endpoint with tool criteria", async () => {
		const calls: Array<{ url: string; body: string }> = [];
		const fetchImpl: JevFetch = async (url, init) => {
			calls.push({ url, body: init.body });
			return {
				ok: true,
				json: async () => ({ answers: { action: { type: "choice", choice: "bash", confidence: 0.9 } } }),
			};
		};
		await createOpenRouterJevClassifier({ apiKey: "key", tools: TOOLS, fetch: fetchImpl })(STATE);
		expect(calls[0].url).toContain("/api/alpha/decisions");
		const body = JSON.parse(calls[0].body);
		expect(body.model).toBe(DEFAULT_OPENROUTER_JEV_MODEL);
		expect(body.questions.action.criteria.bash).toBeDefined();
	});

	it("omits the uncertain hedge when requested", async () => {
		let body = "";
		const fetchImpl: JevFetch = async (_url, init) => {
			body = init.body;
			return {
				ok: true,
				json: async () => ({ answers: { action: { type: "choice", choice: "stop", confidence: 0.9 } } }),
			};
		};
		const classify = createOpenRouterJevClassifier({
			apiKey: "key",
			tools: ["continue"],
			includeUncertain: false,
			criteria: { stop: "done", continue: "more" },
			fetch: fetchImpl,
		});
		await classify(STATE);
		const criteria = JSON.parse(body).questions.action.criteria;
		expect(Object.keys(criteria).sort()).toEqual(["continue", "stop"]);
	});

	it("derives entropy and top probability", () => {
		const probabilities = { bash: 0.9, stop: 0.1 };
		const decision = toJevDecision({ choice: "bash", confidence: 0.6, probabilities }, TOOLS);
		expect(decision?.topProbability).toBe(0.9);
		expect(decision?.entropy).toBeCloseTo(0.469, 3);
	});

	describe("key resolution", () => {
		const ENV_KEY = "OPENROUTER_API_KEY";
		let saved: string | undefined;

		beforeEach(() => {
			saved = process.env[ENV_KEY];
			delete process.env[ENV_KEY];
		});

		afterEach(() => {
			if (saved === undefined) {
				delete process.env[ENV_KEY];
			} else {
				process.env[ENV_KEY] = saved;
			}
		});

		it("uses the resolver when no explicit or environment key exists", async () => {
			const seen: string[] = [];
			const fetchImpl: JevFetch = async (_url, init) => {
				seen.push(init.headers.Authorization);
				return {
					ok: true,
					json: async () => ({ answers: { action: { type: "choice", choice: "bash", confidence: 0.9 } } }),
				};
			};
			const classify = createOpenRouterJevClassifier({
				resolveApiKey: () => "resolved",
				tools: TOOLS,
				fetch: fetchImpl,
			});
			await expect(classify(STATE)).resolves.toMatchObject({ toolName: "bash" });
			expect(seen).toEqual(["Bearer resolved"]);
		});

		it("defers without touching the network when the resolver yields nothing", async () => {
			const fetchImpl = vi.fn<JevFetch>();
			const classify = createOpenRouterJevClassifier({
				resolveApiKey: () => undefined,
				tools: TOOLS,
				fetch: fetchImpl,
			});
			await expect(classify(STATE)).resolves.toBeUndefined();
			expect(fetchImpl).not.toHaveBeenCalled();
		});

		it("defers when the resolver throws", async () => {
			const fetchImpl = vi.fn<JevFetch>();
			const classify = createOpenRouterJevClassifier({
				resolveApiKey: () => {
					throw new Error("vault down");
				},
				tools: TOOLS,
				fetch: fetchImpl,
			});
			await expect(classify(STATE)).resolves.toBeUndefined();
			expect(fetchImpl).not.toHaveBeenCalled();
		});

		it("prefers the explicit key over the resolver", async () => {
			const resolver = vi.fn(() => "resolved");
			const seen: string[] = [];
			const fetchImpl: JevFetch = async (_url, init) => {
				seen.push(init.headers.Authorization);
				return {
					ok: true,
					json: async () => ({ answers: { action: { type: "choice", choice: "bash", confidence: 0.9 } } }),
				};
			};
			await createOpenRouterJevClassifier({
				apiKey: "explicit",
				resolveApiKey: resolver,
				tools: TOOLS,
				fetch: fetchImpl,
			})(STATE);
			expect(seen).toEqual(["Bearer explicit"]);
			expect(resolver).not.toHaveBeenCalled();
		});
	});
});
