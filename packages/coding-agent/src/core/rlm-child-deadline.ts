/**
 * Opt-in dead-man's switch for RLM child runs.
 *
 * A child that stops producing tracked activity is normally only reported
 * through `activity_stale_ms` (see RLM_CHILD_STALE_ACTIVITY_THRESHOLD_MS). When
 * `PRIME_AGENT_RLM_CHILD_IDLE_TIMEOUT_MS` is set to a positive value, the run
 * is instead aborted once it idles past the deadline, so a hung child cannot
 * hold its session, kernel, and socket resources indefinitely.
 *
 * Disabled by default: an unset or non-positive value returns 0 and no timer is
 * created.
 */

import { getLogger } from "@earendil-works/pi-ai";

/** Environment override for the child idle deadline in milliseconds. */
export const RLM_CHILD_IDLE_TIMEOUT_ENV = "PRIME_AGENT_RLM_CHILD_IDLE_TIMEOUT_MS";
/** Prefix on the error recorded when a child run is reaped by the deadline. */
export const RLM_CHILD_ORPHAN_TIMEOUT_PREFIX = "RLM_CHILD_ORPHAN_TIMEOUT";

const logger = getLogger("rlm-child-deadline");

export function resolveRlmChildIdleTimeoutMs(env: Record<string, string | undefined> = process.env): number {
	const raw = env[RLM_CHILD_IDLE_TIMEOUT_ENV];
	if (raw === undefined || raw.trim().length === 0) {
		return 0;
	}
	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed < 0) {
		logger.warn("invalid child idle timeout; dead-man's switch disabled", {
			env: RLM_CHILD_IDLE_TIMEOUT_ENV,
			value: raw,
		});
		return 0;
	}
	return parsed;
}

/** Minimal timer surface so tests can inject fake timers. */
export interface TimerLike {
	unref?: () => void;
}

export type SetTimeoutLike = (handler: () => void, timeoutMs: number) => TimerLike;
export type ClearTimeoutLike = (timer: TimerLike) => void;

export interface RlmChildActivityLike {
	kind?: string;
}

export interface RlmChildIdleDeadlineOptions {
	timeoutMs: number;
	onTimeout: () => void;
	setTimeoutFn?: SetTimeoutLike;
	clearTimeoutFn?: ClearTimeoutLike;
}

const defaultSetTimeout: SetTimeoutLike = (handler, timeoutMs) => setTimeout(handler, timeoutMs);
const defaultClearTimeout: ClearTimeoutLike = (timer) => clearTimeout(timer as NodeJS.Timeout);

/**
 * Re-armed on every tracked child activity. A tool call in flight is
 * legitimately quiet for its whole duration (a minutes-long `bash()` emits no
 * events while it works), so an executing activity disarms the timer instead of
 * resetting it.
 */
export class RlmChildIdleDeadline {
	private timer: TimerLike | undefined;
	private disposed = false;
	private didFire = false;

	constructor(private readonly options: RlmChildIdleDeadlineOptions) {}

	/** True once the deadline fired; used to abort a child that publishes after the timeout. */
	get fired(): boolean {
		return this.didFire;
	}

	kick(activity?: RlmChildActivityLike): void {
		if (this.disposed) {
			return;
		}
		this.clear();
		if (activity?.kind === "executing") {
			return;
		}
		const setTimer = this.options.setTimeoutFn ?? defaultSetTimeout;
		const timer = setTimer(() => {
			this.timer = undefined;
			this.disposed = true;
			this.didFire = true;
			this.options.onTimeout();
		}, this.options.timeoutMs);
		timer.unref?.();
		this.timer = timer;
	}

	dispose(): void {
		this.disposed = true;
		this.clear();
	}

	private clear(): void {
		if (this.timer === undefined) {
			return;
		}
		const clearTimer = this.options.clearTimeoutFn ?? defaultClearTimeout;
		clearTimer(this.timer);
		this.timer = undefined;
	}
}
