import { describe, expect, it, vi } from "vitest";
import { capToolOutput, exceedsOutputCap, type ToolOutputCapOptions } from "../src/core/tool-output-cap.js";

const OPTIONS: ToolOutputCapOptions = { maxLines: 10, maxBytes: 16_384, headRatio: 0.5 };

describe("exceedsOutputCap", () => {
	it.each([
		["under both limits", "a\nb\nc", false],
		["over the line limit", new Array(20).fill("x").join("\n"), true],
		["a single line over the byte limit", "x".repeat(200), true],
	])("flags %s", (_label, text, expected) => {
		expect(exceedsOutputCap(text, { maxLines: 10, maxBytes: 100, headRatio: 0.5 })).toBe(expected);
	});
});

describe("capToolOutput", () => {
	it("leaves small output untouched", () => {
		const write = vi.fn();
		const result = capToolOutput({
			content: [{ type: "text", text: "short" }],
			options: OPTIONS,
			writeScratchpad: write,
		});
		expect(result.capped).toBe(false);
		expect(result.content).toEqual([{ type: "text", text: "short" }]);
		expect(write).not.toHaveBeenCalled();
	});

	it("keeps a head and tail window and points at the full output", () => {
		const lines = Array.from({ length: 100 }, (_value, index) => `line-${index}`);
		const text = lines.join("\n");
		const write = vi.fn(() => "/scratch/tool-output-1.txt");
		const result = capToolOutput({ content: [{ type: "text", text }], options: OPTIONS, writeScratchpad: write });

		expect(result.capped).toBe(true);
		expect(result.fullOutputPath).toBe("/scratch/tool-output-1.txt");
		expect(write).toHaveBeenCalledTimes(1);
		expect(write).toHaveBeenCalledWith(text);
		const bounded = result.content[0];
		expect(bounded.type).toBe("text");
		const body = bounded.type === "text" ? bounded.text : "";
		expect(body).toContain("line-0");
		expect(body).toContain("line-99");
		expect(body).not.toContain("line-50");
		expect(body).toContain("[Full output: /scratch/tool-output-1.txt]");
	});

	it("reuses an existing full-output pointer instead of writing again", () => {
		const write = vi.fn(() => "/scratch/never.txt");
		const result = capToolOutput({
			content: [{ type: "text", text: new Array(50).fill("x").join("\n") }],
			existingFullOutputPath: "/scratch/existing.txt",
			options: OPTIONS,
			writeScratchpad: write,
		});
		expect(result.fullOutputPath).toBe("/scratch/existing.txt");
		expect(write).not.toHaveBeenCalled();
		const body = result.content[0].type === "text" ? result.content[0].text : "";
		expect(body).toContain("[Full output: /scratch/existing.txt]");
	});

	it("preserves non-text parts", () => {
		const result = capToolOutput({
			content: [
				{ type: "text", text: new Array(50).fill("x").join("\n") },
				{ type: "image", data: "AAAA", mimeType: "image/png" },
			],
			options: OPTIONS,
			writeScratchpad: () => "/scratch/tool-output-2.txt",
		});
		expect(result.content).toHaveLength(2);
		expect(result.content[1]).toEqual({ type: "image", data: "AAAA", mimeType: "image/png" });
	});

	it("fails open when the scratchpad write fails", () => {
		const content = [{ type: "text" as const, text: new Array(50).fill("x").join("\n") }];
		const result = capToolOutput({
			content,
			options: OPTIONS,
			writeScratchpad: () => {
				throw new Error("disk full");
			},
		});
		expect(result.capped).toBe(false);
		expect(result.content).toBe(content);
	});
});
