import { describe, it, expect } from "vitest";
import { spliceCardBlock, replaceFirstCardBlock } from "../src/persistence";

describe("spliceCardBlock", () => {
	const doc = ["intro", "```cards", "OLD", "```", "outro"].join("\n");

	it("replaces the body between the fences, keeping surrounds", () => {
		// lineStart = 1 (```cards), lineEnd = 3 (```)
		const out = spliceCardBlock(doc, 1, 3, "NEW");
		expect(out).toBe(["intro", "```cards", "NEW", "```", "outro"].join("\n"));
	});

	it("supports a multi-line new body", () => {
		const out = spliceCardBlock(doc, 1, 3, "A\n\n---\n\nB");
		expect(out).toBe(["intro", "```cards", "A", "", "---", "", "B", "```", "outro"].join("\n"));
	});

	it("targets the correct block when two identical blocks exist", () => {
		const two = [
			"```cards", // 0
			"X", // 1
			"```", // 2
			"mid", // 3
			"```cards", // 4
			"X", // 5
			"```", // 6
		].join("\n");
		// Edit only the second block (lineStart 4, lineEnd 6).
		const out = spliceCardBlock(two, 4, 6, "Y");
		expect(out).toBe(["```cards", "X", "```", "mid", "```cards", "Y", "```"].join("\n"));
	});

	it("handles an empty new body", () => {
		const out = spliceCardBlock(doc, 1, 3, "");
		expect(out).toBe(["intro", "```cards", "", "```", "outro"].join("\n"));
	});
});

describe("replaceFirstCardBlock", () => {
	it("restores a block matched by its exact body", () => {
		const doc = ["intro", "```cards", "B", "", "---", "", "C", "```", "x"].join("\n");
		const out = replaceFirstCardBlock(doc, "B\n\n---\n\nC", "A\n\n---\n\nB\n\n---\n\nC");
		expect(out).toBe(
			["intro", "```cards", "A", "", "---", "", "B", "", "---", "", "C", "```", "x"].join("\n"),
		);
	});

	it("returns null when no block has the given body", () => {
		const doc = ["```cards", "X", "```"].join("\n");
		expect(replaceFirstCardBlock(doc, "Y", "Z")).toBeNull();
	});

	it("only touches the block whose body matches", () => {
		const doc = ["```cards", "X", "```", "mid", "```cards", "Y", "```"].join("\n");
		const out = replaceFirstCardBlock(doc, "Y", "Y2");
		expect(out).toBe(["```cards", "X", "```", "mid", "```cards", "Y2", "```"].join("\n"));
	});

	it("is not fooled by a nested code fence inside a card", () => {
		// The card body itself contains a ```cards-looking fence; only the full
		// outer body should match.
		const body = ["text", "```js", "code", "```", "more"].join("\n");
		const doc = ["```cards", ...body.split("\n"), "```"].join("\n");
		const out = replaceFirstCardBlock(doc, body, "replaced");
		expect(out).toBe(["```cards", "replaced", "```"].join("\n"));
	});
});
