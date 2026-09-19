import type {
	AgentMessage,
	JevClassifier,
	JevState,
	PreTurnReflex,
	PreTurnRouter,
} from "@earendil-works/pi-agent-core";
import {
	classifyJevError,
	createJevStopGate as createAgentStopGate,
	DEFAULT_JEV_MIN_CONFIDENCE,
	evaluateJevDecision,
} from "@earendil-works/pi-agent-core";
import { createOpenRouterJevClassifier, type JevApiKeyResolver } from "./jev-openrouter.js";

/** Choice the classifier returns to re-run the most recent tool call. */
export const JEV_RETRY_CHOICE = "retry_last";
/** Environment flag that enables the Jev pre-turn router. */
export const JEV_ENABLED_ENV = "PRIME_AGENT_JEV_ENABLED";
/** Environment list of zero-argument tools the router may execute directly. */
export const JEV_TOOLS_ENV = "PRIME_AGENT_JEV_TOOLS";
/** Top-probability floor for the concentrated-entropy acceptance path. */
export const JEV_MIN_PROBABILITY = 0.7;
/** Entropy ceiling (bits) for the concentrated-entropy acceptance path. */
export const JEV_MAX_ENTROPY = 0.6;
/** Environment flag that additionally enables the Jev termination gate. */
export const JEV_STOP_ENV = "PRIME_AGENT_JEV_STOP";
/** Positive choice the termination classifier returns to keep the run going. */
export const JEV_CONTINUE_CHOICE = "continue";

const JEV_STOP_INSTRUCTIONS =
	"Decide whether this agent run should stop or continue after the turn just completed. Weigh the goal against lastToolResult and lastAssistantText. Choose continue whenever the goal is not yet satisfied or more work remains.";
const JEV_STOP_CRITERIA: Record<string, string> = {
	stop: "The objective is satisfied and the run should end",
	[JEV_CONTINUE_CHOICE]: "More work is needed; continue the run",
};

const JEV_INSTRUCTIONS =
	"Choose the single best next action from this agent loop state. Weigh errorCategory: TRANSIENT failures (timeouts, rate limits, connection resets) may succeed when repeated, while DETERMINISTIC failures (syntax, name, and type errors, missing files) fail again unchanged. Prefer uncertain when no action clearly helps.";
const JEV_CRITERIA: Record<string, string> = {
	[JEV_RETRY_CHOICE]:
		"Re-run the previous tool call; useful only when the failure was transient (errorCategory TRANSIENT)",
	stop: "The task is complete; stop",
	uncertain: "No action clearly helps; let the model handle this turn",
};

/** True when the opt-in Jev router is enabled for this process. */
export function isJevRouterEnabled(env: Record<string, string | undefined> = process.env): boolean {
	const value = env[JEV_ENABLED_ENV]?.trim().toLowerCase();
	return value === "1" || value === "true" || value === "yes";
}

/** True when the opt-in Jev termination gate is enabled; the router flag is required too. */
export function isJevStopEnabled(env: Record<string, string | undefined> = process.env): boolean {
	const value = env[JEV_STOP_ENV]?.trim().toLowerCase();
	return isJevRouterEnabled(env) && (value === "1" || value === "true" || value === "yes");
}

function configuredTools(env: Record<string, string | undefined>): string[] {
	return (env[JEV_TOOLS_ENV] ?? "")
		.split(",")
		.map((name) => name.trim())
		.filter((name) => name.length > 0);
}

function firstUserText(messages: readonly AgentMessage[]): string | undefined {
	for (const message of messages) {
		if (message.role !== "user") {
			continue;
		}
		const text =
			typeof message.content === "string"
				? message.content
				: message.content
						.map((part) => (part.type === "text" ? part.text : ""))
						.filter((value) => value.length > 0)
						.join("\n");
		const trimmed = text.trim();
		if (trimmed.length > 0) {
			return trimmed.slice(0, 500);
		}
	}
	return undefined;
}

/** Summarizes the transcript into the small state the classifier reasons over. */
export function buildJevState(messages: readonly AgentMessage[], turnIndex: number): JevState {
	let lastToolName: string | undefined;
	let lastToolError: string | undefined;
	let lastToolResult: string | undefined;
	let lastAssistantText: string | undefined;
	let consecutiveFailures = 0;
	for (const message of messages) {
		if (message.role === "assistant") {
			const call = message.content.find((part) => part.type === "toolCall");
			if (call) {
				lastToolName = call.name;
			}
			const assistantText = message.content
				.filter((part) => part.type === "text")
				.map((part) => part.text)
				.join("\n")
				.trim();
			if (assistantText.length > 0) {
				lastAssistantText = assistantText.slice(0, 1000);
			}
			continue;
		}
		if (message.role !== "toolResult") {
			continue;
		}
		lastToolName = message.toolName;
		const text = message.content
			.map((part) => (part.type === "text" ? part.text : ""))
			.filter((value) => value.length > 0)
			.join("\n")
			.trim();
		if (text.length > 0) {
			lastToolResult = text.slice(0, 2000);
		}
		if (message.isError) {
			consecutiveFailures += 1;
			if (text.length > 0) {
				lastToolError = text.slice(0, 2000);
			}
		} else {
			consecutiveFailures = 0;
			lastToolError = undefined;
		}
	}
	const state: JevState = {
		turnIndex,
		consecutiveFailures,
		errorCategory: classifyJevError(lastToolError),
	};
	const goal = firstUserText(messages);
	if (goal) {
		state.goal = goal;
	}
	if (lastToolName) {
		state.lastToolName = lastToolName;
	}
	if (lastToolError) {
		state.lastToolError = lastToolError;
	}
	if (lastToolResult) {
		state.lastToolResult = lastToolResult;
	}
	if (lastAssistantText) {
		state.lastAssistantText = lastAssistantText;
	}
	return state;
}

/** Returns the most recent tool call in the transcript, if any. */
export function deriveLastToolCall(messages: readonly AgentMessage[]): PreTurnReflex | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role !== "assistant") {
			continue;
		}
		const call = message.content.find((part) => part.type === "toolCall");
		if (call) {
			return { toolName: call.name, arguments: call.arguments };
		}
	}
	return undefined;
}

export interface JevRouterOptions {
	/** Zero-argument tools the router may execute without a provider call. */
	tools?: readonly string[];
	/** Injected classifier, mainly for tests. */
	classifier?: JevClassifier;
	apiKey?: string;
	/** Dynamic key source consulted when no explicit key or environment variable is set. */
	resolveApiKey?: JevApiKeyResolver;
	model?: string;
	minConfidence?: number;
	minProbability?: number;
	maxEntropy?: number;
	env?: Record<string, string | undefined>;
}

/**
 * Builds the pre-turn router used by the agent loop.
 *
 * Reflexes are limited to derivable actions: `retry_last` re-runs the previous
 * tool call using arguments already in the transcript, and configured tools are
 * executed with no arguments. `stop` and `uncertain` defer to the provider.
 */
export function createJevPreTurnRouter(options: JevRouterOptions = {}): PreTurnRouter {
	const env = options.env ?? process.env;
	const tools = options.tools ?? configuredTools(env);
	const choices = [JEV_RETRY_CHOICE, ...tools];
	const classifier =
		options.classifier ??
		createOpenRouterJevClassifier({
			tools: choices,
			instructions: JEV_INSTRUCTIONS,
			criteria: JEV_CRITERIA,
			...(options.apiKey ? { apiKey: options.apiKey } : {}),
			...(options.resolveApiKey ? { resolveApiKey: options.resolveApiKey } : {}),
			...(options.model ? { model: options.model } : {}),
		});
	const minConfidence = options.minConfidence ?? DEFAULT_JEV_MIN_CONFIDENCE;
	const minProbability = options.minProbability ?? JEV_MIN_PROBABILITY;
	const maxEntropy = options.maxEntropy ?? JEV_MAX_ENTROPY;

	return async (context) => {
		const { messages } = context.context;
		let decision: Awaited<ReturnType<JevClassifier>>;
		try {
			decision = await classifier(buildJevState(messages, context.turnIndex));
		} catch {
			return undefined;
		}
		const gated = evaluateJevDecision(decision, {
			minConfidence,
			allowedTools: choices,
			minProbability,
			maxEntropy,
		});
		if (!gated || gated.action !== "EXECUTE_TOOL" || !gated.toolName) {
			return undefined;
		}
		if (gated.toolName === JEV_RETRY_CHOICE) {
			return deriveLastToolCall(messages);
		}
		return { toolName: gated.toolName, arguments: {} };
	};
}

/**
 * Builds a post-turn stop predicate backed by the Jev decisions model.
 *
 * The classifier sees only `stop` and `uncertain`, so any non-stop answer
 * continues the run. Termination uses the plain confidence floor without the
 * entropy relaxation the pre-turn router allows: truncating a run is riskier
 * than re-running a tool call.
 */
export function createJevStopGate(options: JevRouterOptions = {}): (state: JevState) => Promise<boolean> {
	const classifier =
		options.classifier ??
		createOpenRouterJevClassifier({
			tools: [JEV_CONTINUE_CHOICE],
			instructions: JEV_STOP_INSTRUCTIONS,
			criteria: JEV_STOP_CRITERIA,
			includeUncertain: false,
			...(options.apiKey ? { apiKey: options.apiKey } : {}),
			...(options.resolveApiKey ? { resolveApiKey: options.resolveApiKey } : {}),
			...(options.model ? { model: options.model } : {}),
		});
	const minConfidence = options.minConfidence ?? DEFAULT_JEV_MIN_CONFIDENCE;
	return createAgentStopGate(classifier, { minConfidence, allowedTools: [] });
}
