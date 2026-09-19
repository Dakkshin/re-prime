import type { JevClassifier, JevDecision, JevState } from "@earendil-works/pi-agent-core";

/** Environment variable holding the OpenRouter API key. */
export const OPENROUTER_JEV_API_KEY_ENV = "OPENROUTER_API_KEY";
/** Auth-storage provider id holding the OpenRouter credential. */
export const OPENROUTER_JEV_PROVIDER_ID = "openrouter";
/** Environment variable overriding the routing model. */
export const OPENROUTER_JEV_MODEL_ENV = "PRIME_AGENT_JEV_MODEL";
/** Default routing model: the TypeSafe Jev decisions model. */
export const DEFAULT_OPENROUTER_JEV_MODEL = "~typesafe/jev-latest";

const OPENROUTER_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
const STOP_CHOICE = "stop";
const UNCERTAIN_CHOICE = "uncertain";
const DEFAULT_INSTRUCTIONS =
	"Choose the single best next action for this agent loop state. Use errorCategory to judge whether repeating the last call can help. Prefer unsure when the state does not clearly determine one action.";

export interface JevHttpResponse {
	ok: boolean;
	json: () => Promise<unknown>;
}

export interface JevRequestInit {
	method: string;
	headers: Record<string, string>;
	body: string;
	signal: AbortSignal;
}

export type JevFetch = (url: string, init: JevRequestInit) => Promise<JevHttpResponse>;

/** Resolves the OpenRouter API key dynamically, e.g. from stored auth. */
export type JevApiKeyResolver = () => string | undefined | Promise<string | undefined>;

export interface OpenRouterJevOptions {
	/** Explicit key, highest priority. */
	apiKey?: string;
	/** Dynamic key source, consulted when no explicit key or environment variable is set. */
	resolveApiKey?: JevApiKeyResolver;
	model?: string;
	timeoutMs?: number;
	fetch?: JevFetch;
	/** Tool names the classifier may choose from, alongside stop and uncertain. */
	tools: readonly string[];
	/** Question text shown to the classifier. */
	instructions?: string;
	/** Per-choice criterion text overriding the generic default. */
	criteria?: Record<string, string>;
	/** Include the generic `uncertain` hedge choice. Defaults to true. */
	includeUncertain?: boolean;
}

/** Parsed `choice` answer from the decisions response. */
export interface JevChoiceAnswer {
	choice: string;
	confidence?: number;
	probabilities?: Record<string, unknown>;
}

const defaultFetch: JevFetch = async (url, init) => {
	const response = await fetch(url, init);
	return { ok: response.ok, json: () => response.json() };
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function maxProbability(probabilities: Record<string, unknown>): number | undefined {
	const values = Object.values(probabilities)
		.map(toNumber)
		.filter((value): value is number => value !== undefined);
	return values.length > 0 ? Math.max(...values) : undefined;
}

function shannonEntropy(probabilities: Record<string, unknown>): number | undefined {
	const values = Object.values(probabilities)
		.map(toNumber)
		.filter((value): value is number => value !== undefined && value > 0);
	if (values.length === 0) {
		return undefined;
	}
	const total = values.reduce((sum, value) => sum + value, 0);
	if (total <= 0) {
		return undefined;
	}
	return -values.reduce((sum, value) => {
		const p = value / total;
		return sum + p * Math.log2(p);
	}, 0);
}

/** Extracts the `choice` answer for the `action` question, rejecting any malformed shape. */
export function parseJevChoiceAnswer(payload: unknown): JevChoiceAnswer | undefined {
	if (!isRecord(payload) || !isRecord(payload.answers)) {
		return undefined;
	}
	const answer = payload.answers.action;
	if (!isRecord(answer) || answer.type !== "choice" || typeof answer.choice !== "string") {
		return undefined;
	}
	const parsed: JevChoiceAnswer = { choice: answer.choice };
	const confidence = toNumber(answer.confidence);
	if (confidence !== undefined) {
		parsed.confidence = confidence;
	}
	if (isRecord(answer.probabilities)) {
		parsed.probabilities = answer.probabilities;
	}
	return parsed;
}

/** Maps a choice answer onto a {@link JevDecision}. Unknown choices are rejected. */
export function toJevDecision(answer: JevChoiceAnswer, tools: readonly string[]): JevDecision | undefined {
	const confidence = answer.confidence ?? (answer.probabilities ? maxProbability(answer.probabilities) : undefined);
	if (confidence === undefined) {
		return undefined;
	}
	const entropy = answer.probabilities ? shannonEntropy(answer.probabilities) : undefined;
	const topProbability = answer.probabilities ? maxProbability(answer.probabilities) : undefined;
	const withEntropy = (decision: JevDecision): JevDecision => {
		const enriched: JevDecision = entropy === undefined ? decision : { ...decision, entropy };
		return topProbability === undefined ? enriched : { ...enriched, topProbability };
	};
	if (answer.choice === UNCERTAIN_CHOICE) {
		return withEntropy({ action: "UNCERTAIN", confidence });
	}
	if (answer.choice === STOP_CHOICE) {
		return withEntropy({ action: "STOP", confidence });
	}
	if (tools.includes(answer.choice)) {
		return withEntropy({ action: "EXECUTE_TOOL", toolName: answer.choice, confidence });
	}
	return undefined;
}

function buildCriteria(
	tools: readonly string[],
	overrides: Record<string, string> | undefined,
	includeUncertain: boolean,
): Record<string, string> {
	const criteria: Record<string, string> = {};
	for (const tool of tools) {
		criteria[tool] = overrides?.[tool] ?? `Run the "${tool}" tool`;
	}
	criteria[STOP_CHOICE] = overrides?.[STOP_CHOICE] ?? "The task is complete; stop";
	if (includeUncertain) {
		criteria[UNCERTAIN_CHOICE] = overrides?.[UNCERTAIN_CHOICE] ?? "Not enough information to decide";
	}
	return criteria;
}

/**
 * Builds a {@link JevClassifier} backed by the OpenRouter decisions endpoint.
 *
 * The decisions API returns calibrated probabilities over the supplied
 * criteria; it never generates text. Fail-safe by construction: a missing API
 * key, timeout, transport error, non-2xx response, or malformed body all
 * resolve to `undefined`, so the loop falls back to the generative model.
 */
export function createOpenRouterJevClassifier(options: OpenRouterJevOptions): JevClassifier {
	const envApiKey = options.apiKey ?? process.env[OPENROUTER_JEV_API_KEY_ENV]?.trim();
	const resolveApiKey = options.resolveApiKey;
	const configuredModel = options.model ?? process.env[OPENROUTER_JEV_MODEL_ENV]?.trim();
	const model = configuredModel && configuredModel.length > 0 ? configuredModel : DEFAULT_OPENROUTER_JEV_MODEL;
	const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
	const fetchImpl = options.fetch ?? defaultFetch;
	const instructions = options.instructions ?? DEFAULT_INSTRUCTIONS;
	const { tools } = options;

	if (!envApiKey && !resolveApiKey) {
		return async () => undefined;
	}

	return async (state: JevState): Promise<JevDecision | undefined> => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const apiKey = envApiKey ?? (await resolveApiKey?.())?.trim() ?? undefined;
			if (!apiKey) {
				return undefined;
			}
			const controller = new AbortController();
			timer = setTimeout(() => controller.abort(), timeoutMs);
			const response = await fetchImpl(OPENROUTER_DECISIONS_URL, {
				method: "POST",
				headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
				body: JSON.stringify({
					model,
					state,
					questions: {
						action: {
							type: "choice",
							instructions,
							criteria: buildCriteria(tools, options.criteria, options.includeUncertain ?? true),
						},
					},
				}),
				signal: controller.signal,
			});
			if (!response.ok) {
				return undefined;
			}
			const answer = parseJevChoiceAnswer(await response.json());
			return answer === undefined ? undefined : toJevDecision(answer, tools);
		} catch {
			return undefined;
		} finally {
			clearTimeout(timer);
		}
	};
}
