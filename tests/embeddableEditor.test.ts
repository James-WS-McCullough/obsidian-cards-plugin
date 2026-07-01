import { describe, it, expect, vi } from "vitest";
import { createCardEditor } from "../src/embeddableEditor";

// In the test environment there's no `app.embedRegistry`, so the internal-prototype
// resolution fails and createCardEditor falls back to the <textarea> editor. These
// tests cover that fallback's behaviour.
describe("createCardEditor (textarea fallback)", () => {
	it("mounts a textarea seeded with the initial value", () => {
		const c = document.createElement("div");
		const h = createCardEditor({} as never, c, { value: "hello" });
		const ta = c.querySelector("textarea");
		expect(ta).toBeTruthy();
		expect(h.getValue()).toBe("hello");
	});

	it("fires onBlur with the current value", () => {
		const c = document.createElement("div");
		const onBlur = vi.fn();
		createCardEditor({} as never, c, { value: "a", onBlur });
		const ta = c.querySelector("textarea")!;
		ta.value = "changed";
		ta.dispatchEvent(new Event("blur"));
		expect(onBlur).toHaveBeenCalledWith("changed");
	});

	it("fires onSubmit on Cmd/Ctrl+Enter and onEscape on Escape", () => {
		const c = document.createElement("div");
		const onSubmit = vi.fn();
		const onEscape = vi.fn();
		createCardEditor({} as never, c, { value: "x", onSubmit, onEscape });
		const ta = c.querySelector("textarea")!;
		ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }));
		expect(onSubmit).toHaveBeenCalledWith("x");
		ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		expect(onEscape).toHaveBeenCalledWith("x");
	});

	it("removes the textarea on destroy", () => {
		const c = document.createElement("div");
		const h = createCardEditor({} as never, c, { value: "x" });
		h.destroy();
		expect(c.querySelector("textarea")).toBeNull();
	});
});
