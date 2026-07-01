import { describe, it, expect } from "vitest";
import { addRecentColor } from "../src/palette";

describe("addRecentColor", () => {
	it("prepends a new colour", () => {
		expect(addRecentColor(["#a", "#b"], "#c")).toEqual(["#c", "#a", "#b"]);
	});

	it("moves an existing colour to the front (dedupe)", () => {
		expect(addRecentColor(["#a", "#b", "#c"], "#c")).toEqual(["#c", "#a", "#b"]);
	});

	it("dedupes case-insensitively", () => {
		expect(addRecentColor(["#AABBCC"], "#aabbcc")).toEqual(["#aabbcc"]);
	});

	it("caps the list at the maximum", () => {
		expect(addRecentColor(["#a", "#b", "#c", "#d"], "#e", 4)).toEqual(["#e", "#a", "#b", "#c"]);
	});

	it("defaults the cap to 4", () => {
		expect(addRecentColor(["#a", "#b", "#c", "#d"], "#e")).toHaveLength(4);
	});
});
