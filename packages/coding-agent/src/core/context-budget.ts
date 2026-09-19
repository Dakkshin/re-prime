import { getLogger } from "@earendil-works/pi-ai";
import type { ImageTtlOptions } from "./image-ttl.js";
import type { ToolOutputCapOptions } from "./tool-output-cap.js";

/** Raw, user-editable budget settings. Every field is optional. */
export interface ContextBudgetSettings {
	toolOutputCap?: {
		enabled?: boolean;
		maxLines?: number;
		maxBytes?: number;
		headRatio?: number;
	};
	imageTtl?: {
		enabled?: boolean;
		ttlTurns?: number;
	};
	contextJanitor?: {
		enabled?: boolean;
		minTokens?: number;
		minTurns?: number;
	};
}

export interface ResolvedContextBudget {
	toolOutputCap: { enabled: boolean; options: ToolOutputCapOptions };
	imageTtl: { enabled: boolean; options: ImageTtlOptions };
	contextJanitor: { enabled: boolean; minTokens: number; minTurns: number };
}

export const DEFAULT_TOOL_OUTPUT_CAP = { enabled: false, maxLines: 200, maxBytes: 16_384, headRatio: 0.6 } as const;
export const DEFAULT_IMAGE_TTL = { enabled: false, ttlTurns: 2 } as const;
export const DEFAULT_CONTEXT_JANITOR = { enabled: false, minTokens: 40_000, minTurns: 15 } as const;

export const CONTEXT_BUDGET_ENV = {
	toolOutputCapEnabled: "PRIME_AGENT_TOOL_OUTPUT_CAP",
	toolOutputCapMaxLines: "PRIME_AGENT_TOOL_OUTPUT_MAX_LINES",
	toolOutputCapMaxBytes: "PRIME_AGENT_TOOL_OUTPUT_MAX_BYTES",
	toolOutputCapHeadRatio: "PRIME_AGENT_TOOL_OUTPUT_HEAD_RATIO",
	imageTtlEnabled: "PRIME_AGENT_IMAGE_TTL",
	imageTtlTurns: "PRIME_AGENT_IMAGE_TTL_TURNS",
	contextJanitorEnabled: "PRIME_AGENT_CONTEXT_JANITOR",
	contextJanitorMinTokens: "PRIME_AGENT_CONTEXT_JANITOR_TOKENS",
	contextJanitorMinTurns: "PRIME_AGENT_CONTEXT_JANITOR_TURNS",
} as const;

const logger = getLogger("context-budget");

function parseBoolean(value: string | undefined): boolean | undefined {
	if (value === undefined) {
		return undefined;
	}
	const normalized = value.trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(normalized)) {
		return true;
	}
	if (["0", "false", "no", "off"].includes(normalized)) {
		return false;
	}
	return undefined;
}

function parseNumber(value: string | undefined): number | undefined {
	if (value === undefined || value.trim().length === 0) {
		return undefined;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function resolvePositiveInt(
	envName: string,
	env: Record<string, string | undefined>,
	setting: number | undefined,
	fallback: number,
): number {
	const raw = env[envName];
	if (raw !== undefined) {
		const parsed = parseNumber(raw);
		if (parsed === undefined || !Number.isInteger(parsed) || parsed <= 0) {
			logger.warn("invalid context budget env value", { env: envName, value: raw, fallback });
		} else {
			return parsed;
		}
	}
	if (setting !== undefined) {
		if (Number.isInteger(setting) && setting > 0) {
			return setting;
		}
		logger.warn("invalid context budget setting", { env: envName, value: setting, fallback });
	}
	return fallback;
}

function resolveNonNegativeInt(
	envName: string,
	env: Record<string, string | undefined>,
	setting: number | undefined,
	fallback: number,
): number {
	const raw = env[envName];
	if (raw !== undefined) {
		const parsed = parseNumber(raw);
		if (parsed === undefined || !Number.isInteger(parsed) || parsed < 0) {
			logger.warn("invalid context budget env value", { env: envName, value: raw, fallback });
		} else {
			return parsed;
		}
	}
	if (setting !== undefined) {
		if (Number.isInteger(setting) && setting >= 0) {
			return setting;
		}
		logger.warn("invalid context budget setting", { env: envName, value: setting, fallback });
	}
	return fallback;
}

function resolveRatio(
	envName: string,
	env: Record<string, string | undefined>,
	setting: number | undefined,
	fallback: number,
): number {
	const raw = env[envName];
	if (raw !== undefined) {
		const parsed = parseNumber(raw);
		if (parsed === undefined || parsed < 0 || parsed > 1) {
			logger.warn("invalid context budget env value", { env: envName, value: raw, fallback });
		} else {
			return parsed;
		}
	}
	if (setting !== undefined) {
		if (setting >= 0 && setting <= 1) {
			return setting;
		}
		logger.warn("invalid context budget setting", { env: envName, value: setting, fallback });
	}
	return fallback;
}

/**
 * Resolves the tool-output cap and image-TTL budget from settings and the
 * environment. Precedence: env > setting > default. Invalid values warn and
 * fall back to the default; this never throws.
 */
export function resolveContextBudget(
	settings: ContextBudgetSettings = {},
	env: Record<string, string | undefined> = process.env,
): ResolvedContextBudget {
	return {
		toolOutputCap: {
			enabled:
				parseBoolean(env[CONTEXT_BUDGET_ENV.toolOutputCapEnabled]) ?? settings.toolOutputCap?.enabled ?? false,
			options: {
				maxLines: resolvePositiveInt(
					CONTEXT_BUDGET_ENV.toolOutputCapMaxLines,
					env,
					settings.toolOutputCap?.maxLines,
					DEFAULT_TOOL_OUTPUT_CAP.maxLines,
				),
				maxBytes: resolvePositiveInt(
					CONTEXT_BUDGET_ENV.toolOutputCapMaxBytes,
					env,
					settings.toolOutputCap?.maxBytes,
					DEFAULT_TOOL_OUTPUT_CAP.maxBytes,
				),
				headRatio: resolveRatio(
					CONTEXT_BUDGET_ENV.toolOutputCapHeadRatio,
					env,
					settings.toolOutputCap?.headRatio,
					DEFAULT_TOOL_OUTPUT_CAP.headRatio,
				),
			},
		},
		imageTtl: {
			enabled: parseBoolean(env[CONTEXT_BUDGET_ENV.imageTtlEnabled]) ?? settings.imageTtl?.enabled ?? false,
			options: {
				ttlTurns: resolveNonNegativeInt(
					CONTEXT_BUDGET_ENV.imageTtlTurns,
					env,
					settings.imageTtl?.ttlTurns,
					DEFAULT_IMAGE_TTL.ttlTurns,
				),
			},
		},
		contextJanitor: {
			enabled:
				parseBoolean(env[CONTEXT_BUDGET_ENV.contextJanitorEnabled]) ?? settings.contextJanitor?.enabled ?? false,
			minTokens: resolvePositiveInt(
				CONTEXT_BUDGET_ENV.contextJanitorMinTokens,
				env,
				settings.contextJanitor?.minTokens,
				DEFAULT_CONTEXT_JANITOR.minTokens,
			),
			minTurns: resolvePositiveInt(
				CONTEXT_BUDGET_ENV.contextJanitorMinTurns,
				env,
				settings.contextJanitor?.minTurns,
				DEFAULT_CONTEXT_JANITOR.minTurns,
			),
		},
	};
}
