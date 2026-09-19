import type { PreTurnRouter } from "./types.js";

/**
 * Jev is a discrete control-flow classifier that runs before the generative
 * model on each turn. It maps loop state onto a fixed set of next actions so
 * routine routing decisions do not require an autoregressive model call.
 *
 * This package defines only the contract. Concrete classifiers (a hosted small
 * model, a local encoder) live in the host package behind {@link JevClassifier}.
 */

/** The finite action set a classifier may choose from. */
export type JevAction = "EXECUTE_TOOL" | "DELEGATE" | "STOP" | "UNCERTAIN";

/** A classifier's proposed next action with its self-reported confidence. */
export interface JevDecision {
	action: JevAction;
	/** Target tool for `EXECUTE_TOOL` decisions. */
	toolName?: string;
	/** Probability in [0, 1] that the action is correct. */
	confidence: number;
	/** Optional Shannon entropy of the underlying action distribution. */
	entropy?: number;
	/** Highest probability in the action distribution, when the classifier reports it. */
	topProbability?: number;
}

/**
 * Whether repeating the previous action can plausibly change the outcome.
 *
 * Derived in code, never by the classifier: retrying a deterministic error
 * reruns the same failing call, while a transient failure may recover.
 */
export type JevErrorCategory = "TRANSIENT" | "DETERMINISTIC" | "NONE";

const TRANSIENT_ERROR_PATTERN =
	/ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|EPIPE|socket hang up|rate limit|too many requests|\b429\b|\b50[0234]\b|timed out|timeout|temporarily unavailable|resource busy|try again|lock wait/iu;
const DETERMINISTIC_ERROR_PATTERN =
	/SyntaxError|NameError|TypeError|ReferenceError|ValueError|IndentationError|ImportError|ModuleNotFoundError|command not found|no such file|\b404\b|ENOENT|permission denied|already exists/iu;

/** Classifies tool error text into the retry-relevance category the classifier reasons over. */
export function classifyJevError(error: string | undefined): JevErrorCategory {
	if (!error || error.length === 0) {
		return "NONE";
	}
	if (TRANSIENT_ERROR_PATTERN.test(error)) {
		return "TRANSIENT";
	}
	if (DETERMINISTIC_ERROR_PATTERN.test(error)) {
		return "DETERMINISTIC";
	}
	return "NONE";
}

/** Minimal, serializable view of the loop state handed to a classifier. */
export interface JevState {
	/** Current objective, when one is active. */
	goal?: string;
	/** Zero-based turn index within the run. */
	turnIndex: number;
	/** Name of the most recently executed tool, if any. */
	lastToolName?: string;
	/** Error text from the most recent tool result, if the call failed. */
	lastToolError?: string;
	/** Text from the most recent tool result, whether it succeeded or failed. */
	lastToolResult?: string;
	/** Text from the most recent assistant message, when it contained any. */
	lastAssistantText?: string;
	/** Deterministic retry-relevance of the most recent error. */
	errorCategory?: JevErrorCategory;
	/** Consecutive failed tool turns immediately preceding this one. */
	consecutiveFailures: number;
}

/**
 * Classifies the current loop state.
 *
 * Contract: must not throw. Return `undefined` to defer to the generative
 * model; the loop treats a missing decision as "no opinion".
 */
export type JevClassifier = (state: JevState) => Promise<JevDecision | undefined>;

/** Confidence floor used when the host does not configure one. */
export const DEFAULT_JEV_MIN_CONFIDENCE = 0.85;

export interface JevGateOptions {
	/** Minimum confidence a decision must reach to be accepted. */
	minConfidence: number;
	/** Tools a reflex decision may execute without a model call. */
	allowedTools: readonly string[];
	/** Lower bound on the top probability for the concentrated-entropy path. */
	minProbability?: number;
	/** Upper bound on Shannon entropy for the concentrated-entropy path. */
	maxEntropy?: number;
}

/**
 * Accepts a below-floor decision only when the distribution is concentrated.
 *
 * Absolute confidence is calibrated conservatively, so a clear winner can sit
 * under the floor; low entropy plus a strong top probability is still decisive.
 */
function meetsEntropyBar(decision: JevDecision, options: JevGateOptions): boolean {
	const { minProbability, maxEntropy } = options;
	if (minProbability === undefined || maxEntropy === undefined) {
		return false;
	}
	if (decision.entropy === undefined || !Number.isFinite(decision.entropy)) {
		return false;
	}
	const top = decision.topProbability ?? decision.confidence;
	return Number.isFinite(top) && top >= minProbability && decision.entropy <= maxEntropy;
}

/**
 * Deterministic gate applied to a raw classifier decision.
 *
 * Any decision that is absent, `UNCERTAIN`, below the confidence floor, or
 * names a tool outside the reflex allow-list is rejected, so the loop falls
 * back to the generative model instead of guessing.
 */
export function evaluateJevDecision(
	decision: JevDecision | undefined,
	options: JevGateOptions,
): JevDecision | undefined {
	if (!decision) {
		return undefined;
	}
	if (decision.action === "UNCERTAIN") {
		return undefined;
	}
	if (!Number.isFinite(decision.confidence)) {
		return undefined;
	}
	if (decision.confidence < options.minConfidence && !meetsEntropyBar(decision, options)) {
		return undefined;
	}
	if (decision.action === "EXECUTE_TOOL") {
		if (!decision.toolName || !options.allowedTools.includes(decision.toolName)) {
			return undefined;
		}
	}
	return decision;
}

/**
 * Classifies whether the run should stop, given the current loop state.
 *
 * Contract: must not throw. Return `undefined` to defer to the generative model.
 */
export type JevStopDecider = (state: JevState) => Promise<JevDecision | undefined>;

/**
 * Adapts a {@link JevStopDecider} into a post-turn stop predicate.
 *
 * Only a gated `STOP` decision ends the run. Any other action, a thrown error,
 * or a sub-threshold decision continues, so a classifier can never truncate a
 * run on a weak or malformed signal.
 */
export function createJevStopGate(
	decider: JevStopDecider,
	options: JevGateOptions,
): (state: JevState) => Promise<boolean> {
	return async (state) => {
		let decision: JevDecision | undefined;
		try {
			decision = await decider(state);
		} catch {
			return false;
		}
		return evaluateJevDecision(decision, options)?.action === "STOP";
	};
}

/**
 * Adapts a {@link JevClassifier} into a {@link PreTurnRouter}.
 *
 * Only allow-listed, zero-argument tools are executed. `STOP`, `DELEGATE`,
 * `UNCERTAIN`, and sub-floor decisions fall through to the provider, so a
 * classifier can never fabricate tool arguments.
 */
export function createZeroArgReflexRouter(classifier: JevClassifier, options: JevGateOptions): PreTurnRouter {
	return async (routerContext) => {
		let rawDecision: JevDecision | undefined;
		try {
			rawDecision = await classifier({
				turnIndex: routerContext.turnIndex,
				consecutiveFailures: 0,
			});
		} catch {
			return undefined;
		}
		const decision = evaluateJevDecision(rawDecision, options);
		if (!decision || decision.action !== "EXECUTE_TOOL" || !decision.toolName) {
			return undefined;
		}
		return { toolName: decision.toolName, arguments: {} };
	};
}
