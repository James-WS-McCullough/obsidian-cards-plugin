import { describe, it, expect } from "vitest";
import {
	parseCards,
	serializeCards,
	parseStack,
	serializeStack,
	toggleTaskInCard,
	Card,
} from "../src/parser";

describe("parseCards", () => {
	it("returns no cards for empty/blank source", () => {
		expect(parseCards("")).toEqual([]);
		expect(parseCards("   \n  ")).toEqual([]);
	});

	it("parses a single card", () => {
		expect(parseCards("Hello world")).toEqual([
			{ text: "Hello world", color: null, highlight: false },
		]);
	});

	it("splits cards on a `---` line", () => {
		const cards = parseCards("A\n\n---\n\nB\n\n---\n\nC");
		expect(cards.map((c) => c.text)).toEqual(["A", "B", "C"]);
	});

	it("trims blank edges but preserves internal blank lines", () => {
		const [card] = parseCards("\n\nline 1\n\nline 2\n\n");
		expect(card.text).toBe("line 1\n\nline 2");
	});

	it("extracts a colour marker and strips it from the text", () => {
		const [card] = parseCards("<!-- cards-color: #e0533d -->\nHello");
		expect(card).toEqual({ text: "Hello", color: "#e0533d", highlight: false });
	});

	it("extracts a highlight marker", () => {
		const [card] = parseCards("<!-- cards-highlight -->\nHi");
		expect(card).toEqual({ text: "Hi", color: null, highlight: true });
	});

	it("extracts both markers in any order", () => {
		const a = parseCards("<!-- cards-highlight -->\n<!-- cards-color: #fff -->\nX")[0];
		const b = parseCards("<!-- cards-color: #fff -->\n<!-- cards-highlight -->\nX")[0];
		expect(a).toEqual({ text: "X", color: "#fff", highlight: true });
		expect(b).toEqual({ text: "X", color: "#fff", highlight: true });
	});

	it("accepts named colours", () => {
		expect(parseCards("<!-- cards-color: rebeccapurple -->\nY")[0].color).toBe("rebeccapurple");
	});

	it("does not treat a comment in the body as a marker", () => {
		const [card] = parseCards("Body\n<!-- cards-color: #fff -->");
		expect(card.color).toBeNull();
		expect(card.text).toBe("Body\n<!-- cards-color: #fff -->");
	});
});

describe("serializeCards", () => {
	it("joins cards with a separator", () => {
		const cards: Card[] = [
			{ text: "A", color: null, highlight: false },
			{ text: "B", color: null, highlight: false },
		];
		expect(serializeCards(cards)).toBe("A\n\n---\n\nB");
	});

	it("emits markers for colour and highlight", () => {
		const out = serializeCards([{ text: "A", color: "#abc", highlight: true }]);
		expect(out).toContain("<!-- cards-highlight -->");
		expect(out).toContain("<!-- cards-color: #abc -->");
		expect(out.trimEnd().endsWith("A")).toBe(true);
	});

	it("round-trips through parse → serialize → parse", () => {
		const source =
			"<!-- cards-color: #e0533d -->\n## Title\n- [x] done\n- [ ] todo\n\n---\n\n<!-- cards-highlight -->\nPlain card";
		const once = parseCards(source);
		const twice = parseCards(serializeCards(once));
		expect(twice).toEqual(once);
	});
});

describe("parseStack / serializeStack", () => {
	it("has no template for a plain block", () => {
		const stack = parseStack("A\n\n---\n\nB");
		expect(stack.template).toBeNull();
		expect(stack.cards.map((c) => c.text)).toEqual(["A", "B"]);
	});

	it("extracts a leading template and keeps it out of the cards", () => {
		const stack = parseStack("<!-- cards-template -->\n- [ ] task\n\n---\n\nA");
		expect(stack.template).toBe("- [ ] task");
		expect(stack.cards.map((c) => c.text)).toEqual(["A"]);
	});

	it("supports a template with no cards yet", () => {
		const stack = parseStack("<!-- cards-template -->\nHeading");
		expect(stack.template).toBe("Heading");
		expect(stack.cards).toEqual([]);
	});

	it("treats an empty template body as no template", () => {
		expect(parseStack("<!-- cards-template -->").template).toBeNull();
	});

	it("only treats the first chunk as a template", () => {
		const stack = parseStack("A\n\n---\n\n<!-- cards-template -->\nB");
		expect(stack.template).toBeNull();
		expect(stack.cards).toHaveLength(2);
		expect(stack.cards[1].text).toContain("<!-- cards-template -->");
	});

	it("serializes a template ahead of the cards", () => {
		const out = serializeStack("- [ ] x", [
			{ text: "A", color: null, highlight: false },
		]);
		expect(out).toBe("<!-- cards-template -->\n- [ ] x\n\n---\n\nA");
	});

	it("omits the marker when there is no template", () => {
		const cards: Card[] = [{ text: "A", color: null, highlight: false }];
		expect(serializeStack(null, cards)).toBe(serializeCards(cards));
		expect(serializeStack("  ", cards)).toBe(serializeCards(cards));
	});

	it("round-trips template + cards through serialize → parse", () => {
		const cards: Card[] = [
			{ text: "First", color: "#abc", highlight: false },
			{ text: "Second", color: null, highlight: true },
		];
		const body = serializeStack("## {{title}}\n- [ ] ", cards);
		const back = parseStack(body);
		expect(back.template).toBe("## {{title}}\n- [ ] ");
		expect(back.cards).toEqual(cards);
	});
});

describe("toggleTaskInCard", () => {
	it("flips the nth task (0-based, source order)", () => {
		const text = "- [ ] one\n- [ ] two\n- [ ] three";
		expect(toggleTaskInCard(text, 1)).toBe("- [ ] one\n- [x] two\n- [ ] three");
	});

	it("unchecks a checked task", () => {
		expect(toggleTaskInCard("- [x] done", 0)).toBe("- [ ] done");
	});

	it("ignores non-task lines when counting", () => {
		const text = "intro\n- [ ] a\nmiddle\n- [ ] b";
		expect(toggleTaskInCard(text, 1)).toBe("intro\n- [ ] a\nmiddle\n- [x] b");
	});

	it("handles indented and *-bulleted tasks", () => {
		expect(toggleTaskInCard("  * [ ] x", 0)).toBe("  * [x] x");
	});

	it("is a no-op when the ordinal is out of range", () => {
		expect(toggleTaskInCard("- [ ] a", 5)).toBe("- [ ] a");
	});

	it("is a no-op when there are no tasks", () => {
		expect(toggleTaskInCard("just text", 0)).toBe("just text");
	});
});
