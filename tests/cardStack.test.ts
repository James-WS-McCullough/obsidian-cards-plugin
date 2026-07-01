import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared refs the hoisted mocks write into.
const h = vi.hoisted(() => ({
	sortableOpts: { current: null as Record<string, () => void> | null },
	lastEditor: { current: null as { opts: Record<string, (v: string) => void> } | null },
}));

vi.mock("sortablejs", () => ({
	default: {
		create: (_el: HTMLElement, opts: Record<string, () => void>) => {
			h.sortableOpts.current = opts;
			return { destroy() {} };
		},
	},
}));

vi.mock("../src/embeddableEditor", () => ({
	createCardEditor: (_app: unknown, container: HTMLElement, opts: Record<string, (v: string) => void>) => {
		const ta = document.createElement("textarea");
		ta.value = (opts as unknown as { value: string }).value;
		container.appendChild(ta);
		const handle = {
			opts,
			getValue: () => ta.value,
			focus() {},
			setCursorToClick() {},
			destroy() {
				ta.remove();
			},
		};
		h.lastEditor.current = handle;
		return handle;
	},
}));

vi.mock("../src/persistence", () => ({
	writeCardBlock: vi.fn(async () => true),
}));

import { CardStack } from "../src/cardStack";
import { writeCardBlock } from "../src/persistence";

const writeMock = writeCardBlock as unknown as ReturnType<typeof vi.fn>;

function lastBody(): string {
	const calls = writeMock.mock.calls;
	return calls[calls.length - 1][3] as string;
}

function makeStack(source: string) {
	const plugin = {
		app: {},
		settings: { recentColors: [] as string[] },
		addRecentColor: vi.fn(),
	};
	const container = document.createElement("div");
	document.body.appendChild(container);
	const ctx = {
		sourcePath: "note.md",
		getSectionInfo: () => ({ text: "", lineStart: 0, lineEnd: 0 }),
		addChild: () => {},
	};
	const stack = new CardStack(plugin as never, source, container, ctx as never);
	(stack as unknown as { load(): void }).load();
	return { stack: stack as unknown as Record<string, (...a: unknown[]) => unknown>, container, plugin };
}

const cards = (c: HTMLElement) => c.querySelectorAll(".cards-card");
const click = (el: Element) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));

beforeEach(() => {
	vi.clearAllMocks();
	document.body.innerHTML = "";
	h.sortableOpts.current = null;
	h.lastEditor.current = null;
});

describe("CardStack rendering", () => {
	it("renders one element per card", () => {
		const { container } = makeStack("A\n\n---\n\nB\n\n---\n\nC");
		expect(cards(container)).toHaveLength(3);
	});

	it("shows a placeholder for an empty card", () => {
		const { container } = makeStack("");
		expect(cards(container)).toHaveLength(0);
		expect(container.querySelector(".cards-add")).toBeTruthy();
	});
});

describe("checkboxes", () => {
	it("toggles the source and persists on checkbox click", () => {
		const { container } = makeStack("- [ ] task");
		click(container.querySelector("input.task-list-item-checkbox")!);
		expect(writeMock).toHaveBeenCalled();
		expect(lastBody()).toContain("- [x] task");
	});

	it("toggles the correct checkbox by ordinal", () => {
		const { container } = makeStack("- [ ] a\n- [ ] b");
		const boxes = container.querySelectorAll("input.task-list-item-checkbox");
		click(boxes[1]);
		expect(lastBody()).toBe("- [ ] a\n- [x] b");
	});
});

describe("editing", () => {
	it("enters edit on content click and commits changed text on blur", () => {
		const { container } = makeStack("Hello");
		click(container.querySelector(".cards-card-content")!);
		expect(container.querySelector("textarea")).toBeTruthy();
		h.lastEditor.current!.opts.onBlur("Hello edited");
		expect(lastBody()).toBe("Hello edited");
	});

	it("does NOT clobber an in-progress edit when a checkbox is clicked while editing", () => {
		const { container } = makeStack("- [ ] task");
		click(container.querySelector(".cards-card-content")!); // enter edit
		writeMock.mockClear();
		// Simulate the editor having rendered a checkbox and the user clicking it.
		const content = container.querySelector(".cards-card-content")!;
		const cb = document.createElement("input");
		cb.className = "task-list-item-checkbox";
		cb.type = "checkbox";
		content.appendChild(cb);
		click(cb);
		expect(writeMock).not.toHaveBeenCalled();
		expect(content.querySelector("textarea")).toBeTruthy(); // editor still alive
	});
});

describe("structural mutations", () => {
	it("adds a card at the end and opens it for editing", () => {
		const { container } = makeStack("A");
		click(container.querySelector(".cards-add")!);
		expect(cards(container)).toHaveLength(2);
		expect(container.querySelector("textarea")).toBeTruthy();
	});

	it("inserts a card below a given card", () => {
		const { container } = makeStack("A\n\n---\n\nB");
		click(cards(container)[0].querySelector(".cards-add-below")!);
		expect(cards(container)).toHaveLength(3);
	});

	it("deletes a card and persists the remainder", () => {
		const { container } = makeStack("A\n\n---\n\nB");
		click(cards(container)[0].querySelector(".cards-delete")!);
		expect(cards(container)).toHaveLength(1);
		expect(lastBody()).toBe("B");
	});
});

describe("reordering", () => {
	it("maps the new DOM order back to the card array on drop", () => {
		const { container } = makeStack("A\n\n---\n\nB\n\n---\n\nC");
		const list = container.querySelector(".cards-list")!;
		// Move the first card (A, data-index 0) to the end → DOM order indices 1,2,0.
		list.appendChild(list.children[0]);
		h.sortableOpts.current!.onEnd();
		expect(lastBody()).toBe("B\n\n---\n\nC\n\n---\n\nA");
	});
});

describe("templates", () => {
	const TEMPLATED = "<!-- cards-template -->\n- [ ] todo\n\n---\n\nA";

	it("marks the gear when the list has a template", () => {
		const { container } = makeStack(TEMPLATED);
		expect(container.querySelector(".cards-template-btn.is-set")).toBeTruthy();
	});

	it("seeds a newly added card from the list template", () => {
		const { container } = makeStack(TEMPLATED);
		click(container.querySelector(".cards-add")!);
		expect(h.lastEditor.current!.getValue()).toBe("- [ ] todo");
	});

	it("seeds an inserted-below card from the list template", () => {
		const { container } = makeStack(TEMPLATED);
		click(cards(container)[0].querySelector(".cards-add-below")!);
		expect(h.lastEditor.current!.getValue()).toBe("- [ ] todo");
	});

	it("keeps the template in the source when cards change", () => {
		const { container } = makeStack(TEMPLATED);
		click(container.querySelector(".cards-card-content")!); // edit card A
		h.lastEditor.current!.opts.onBlur("A edited");
		expect(lastBody()).toContain("<!-- cards-template -->");
		expect(lastBody()).toContain("A edited");
	});

	it("adds no template marker for a plain list", () => {
		const { container } = makeStack("A");
		expect(container.querySelector(".cards-template-btn.is-set")).toBeFalsy();
		click(container.querySelector(".cards-card-content")!);
		h.lastEditor.current!.opts.onBlur("A edited");
		expect(lastBody()).not.toContain("cards-template");
	});
});

describe("colour & highlight", () => {
	it("applies a colour strip, persists the marker, and records the colour", () => {
		const { stack, container, plugin } = makeStack("A");
		stack.setCardColor(0, "#ff0000");
		expect(container.querySelector(".cards-color-strip")).toBeTruthy();
		expect(lastBody()).toContain("<!-- cards-color: #ff0000 -->");
		expect(plugin.addRecentColor).toHaveBeenCalledWith("#ff0000");
	});

	it("toggles the highlight class and persists the marker", () => {
		const { stack, container } = makeStack("A");
		stack.setCardHighlight(0, true);
		expect(container.querySelector(".cards-card--highlight")).toBeTruthy();
		expect(lastBody()).toContain("<!-- cards-highlight -->");
	});
});
