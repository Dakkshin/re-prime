import { afterEach, describe, expect, it, vi } from "vitest";
import {
	RLM_CHILD_IDLE_TIMEOUT_ENV,
	RlmChildIdleDeadline,
	resolveRlmChildIdleTimeoutMs,
} from "../src/core/rlm-child-deadline.js";

describe("resolveRlmChildIdleTimeoutMs", () => {
	it.each<[string | undefined, number]>([
		[undefined, 0],
		["", 0],
		["0", 0],
		["250", 250],
		["abc", 0],
		["-5", 0],
		["1.5", 0],
	])("resolves %s to %i", (raw, expected) => {
		const env = raw === undefined ? {} : { [RLM_CHILD_IDLE_TIMEOUT_ENV]: raw };
		expect(resolveRlmChildIdleTimeoutMs(env)).toBe(expected);
	});
});

describe("RlmChildIdleDeadline", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("fires once past the deadline and reports fired", () => {
		vi.useFakeTimers();
		const onTimeout = vi.fn();
		const deadline = new RlmChildIdleDeadline({ timeoutMs: 1000, onTimeout });
		deadline.kick();
		expect(deadline.fired).toBe(false);
		vi.advanceTimersByTime(999);
		expect(onTimeout).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(onTimeout).toHaveBeenCalledOnce();
		expect(deadline.fired).toBe(true);
		vi.advanceTimersByTime(10_000);
		expect(onTimeout).toHaveBeenCalledOnce();
	});

	it("re-arms on each kick", () => {
		vi.useFakeTimers();
		const onTimeout = vi.fn();
		const deadline = new RlmChildIdleDeadline({ timeoutMs: 1000, onTimeout });
		deadline.kick();
		vi.advanceTimersByTime(800);
		deadline.kick();
		vi.advanceTimersByTime(800);
		expect(onTimeout).not.toHaveBeenCalled();
		vi.advanceTimersByTime(200);
		expect(onTimeout).toHaveBeenCalledOnce();
	});

	it("disarms while a tool is executing and re-arms when it finishes", () => {
		vi.useFakeTimers();
		const onTimeout = vi.fn();
		const deadline = new RlmChildIdleDeadline({ timeoutMs: 1000, onTimeout });
		deadline.kick({ kind: "executing" });
		vi.advanceTimersByTime(60_000);
		expect(onTimeout).not.toHaveBeenCalled();
		deadline.kick({ kind: "waiting" });
		vi.advanceTimersByTime(1000);
		expect(onTimeout).toHaveBeenCalledOnce();
	});

	it("stops firing after dispose", () => {
		vi.useFakeTimers();
		const onTimeout = vi.fn();
		const deadline = new RlmChildIdleDeadline({ timeoutMs: 1000, onTimeout });
		deadline.kick();
		deadline.dispose();
		deadline.kick();
		expect(deadline.fired).toBe(false);
		vi.advanceTimersByTime(10_000);
		expect(onTimeout).not.toHaveBeenCalled();
	});
});
