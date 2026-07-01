/**
 * Isolated wrapper around Obsidian's internal markdown editor.
 *
 * This is the one module that touches undocumented internals (`app.embedRegistry`
 * and the live editor's prototype). The technique originates in Obsidian Kanban
 * and Fevol's public "EmbeddableMarkdownEditor" gist (MIT), copied by ~20 plugins.
 * It yields a *true Live Preview* editor (rendered widgets while typing), because
 * we subclass Obsidian's real editor and inherit its extension set.
 *
 * Everything fragile is confined here behind `createCardEditor`, which:
 *   - resolves the internal prototype lazily (only when a card is first edited,
 *     where an active markdown file is guaranteed) and caches the built class;
 *   - falls back to a plain auto-sizing <textarea> if anything throws, so an
 *     Obsidian update that breaks the internals degrades editing instead of
 *     killing the plugin.
 */

import { App, Scope } from "obsidian";
import { EditorSelection, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder, tooltips, ViewUpdate } from "@codemirror/view";
import { around } from "monkey-around";

export interface CardEditorOptions {
	value: string;
	placeholder?: string;
	cls?: string;
	/** Fires on every document change. */
	onChange?: (value: string) => void;
	/** Fires when the editor loses focus. */
	onBlur?: (value: string) => void;
	/** Fires on Cmd/Ctrl+Enter. */
	onSubmit?: (value: string) => void;
	/** Fires on Escape. */
	onEscape?: (value: string) => void;
}

/** The interface the rest of the plugin programs against — backend-agnostic. */
export interface CardEditorHandle {
	focus(): void;
	getValue(): string;
	/** Place the caret at a viewport coordinate (for "click lands in editor"). */
	setCursorToClick(x: number, y: number): void;
	destroy(): void;
}

// --- Internal-prototype resolution (the fragile part) -----------------------

/* eslint-disable @typescript-eslint/no-explicit-any */

function resolveEditorPrototype(app: any): any {
	const activeFile = app.workspace.getActiveFile();
	if (!activeFile) {
		throw new Error("Cards: no active file to resolve editor prototype from.");
	}

	const widget = app.embedRegistry.embedByExtension.md(
		{ app, containerEl: document.createElement("div") },
		activeFile,
		"",
	);
	widget.editable = true;
	widget.showEditor();

	const editMode = widget.editMode;
	if (!editMode) {
		widget.unload();
		throw new Error("Cards: editor edit mode was not initialized.");
	}

	const proto = Object.getPrototypeOf(Object.getPrototypeOf(editMode));
	widget.unload();
	return proto.constructor;
}

function buildEditorClass(Base: any): any {
	return class CardsEmbeddedEditor extends Base implements CardEditorHandle {
		options: CardEditorOptions;
		scope: Scope;
		private uninstaller?: () => void;

		constructor(app: App, container: HTMLElement, options: CardEditorOptions) {
			super(app, container, {
				app,
				onMarkdownScroll: () => {},
				getMode: () => "source",
			});

			this.options = options;
			this.scope = new Scope((this.app as any).scope);
			// Keep our own Mod+Enter from triggering workspace defaults.
			this.scope.register(["Mod"], "Enter", () => true);
			this.scope.register(["Mod", "Shift"], "Enter", () => true);

			this.owner.editMode = this;
			this.owner.editor = this.editor;

			// Obsidian 1.5.8+ requires explicitly setting the initial value.
			this.set(options.value || "");

			// Stop the workspace from stealing focus while this editor is active.
			this.uninstaller = around(this.app.workspace as any, {
				setActiveLeaf:
					(old: any) =>
					function (this: any, ...args: any[]) {
						if (!this.activeCM?.hasFocus) {
							old.call(this, ...args);
						}
					},
			});

			const contentDOM: HTMLElement = this.editor.cm.contentDOM;
			contentDOM.addEventListener("blur", () => {
				this.app.keymap.popScope(this.scope);
				if (this._loaded) this.options.onBlur?.(this.getValue());
			});
			contentDOM.addEventListener("focusin", () => {
				this.app.keymap.pushScope(this.scope);
			});

			if (options.cls) this.editorEl.classList.add(options.cls);
		}

		getValue(): string {
			return this.editor.cm.state.doc.toString();
		}

		focus(): void {
			this.editor.cm.focus();
		}

		setCursorToClick(x: number, y: number): void {
			const view: EditorView = this.editor.cm;
			const pos = view.posAtCoords({ x, y });
			if (pos != null) {
				view.dispatch({ selection: EditorSelection.cursor(pos) });
			}
			view.focus();
		}

		onUpdate(update: ViewUpdate, changed: boolean): void {
			super.onUpdate(update, changed);
			if (changed) this.options.onChange?.(this.getValue());
		}

		buildLocalExtensions(): any[] {
			const extensions: any[] = super.buildLocalExtensions();
			extensions.push(tooltips({ parent: this.containerEl.ownerDocument.body }));
			if (this.options.placeholder) {
				extensions.push(placeholder(this.options.placeholder));
			}
			extensions.push(
				Prec.highest(
					keymap.of([
						{
							key: "Mod-Enter",
							run: () => {
								this.options.onSubmit?.(this.getValue());
								return true;
							},
						},
						{
							key: "Escape",
							run: () => {
								this.options.onEscape?.(this.getValue());
								return true;
							},
						},
					]),
				),
			);
			return extensions;
		}

		destroy(): void {
			if (this._loaded) this.unload();
			this.app.keymap.popScope(this.scope);
			this.uninstaller?.();
			this.uninstaller = undefined;
			this.containerEl.empty();
			super.destroy();
		}
	};
}

let cachedClass: any = null;
let resolutionFailed = false;

function getEditorClass(app: App): any {
	if (cachedClass) return cachedClass;
	if (resolutionFailed) return null;
	try {
		cachedClass = buildEditorClass(resolveEditorPrototype(app));
		return cachedClass;
	} catch (e) {
		console.error("Cards: embedded CM6 editor unavailable, using textarea fallback.", e);
		resolutionFailed = true;
		return null;
	}
}

// --- Textarea fallback ------------------------------------------------------

class TextareaEditor implements CardEditorHandle {
	private el: HTMLTextAreaElement;

	constructor(container: HTMLElement, private options: CardEditorOptions) {
		this.el = container.createEl("textarea", { cls: "cards-card-textarea" });
		if (options.cls) this.el.addClass(options.cls);
		this.el.value = options.value;
		if (options.placeholder) this.el.placeholder = options.placeholder;
		this.autosize();

		this.el.addEventListener("input", () => {
			this.autosize();
			this.options.onChange?.(this.el.value);
		});
		this.el.addEventListener("blur", () => this.options.onBlur?.(this.el.value));
		this.el.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				e.preventDefault();
				this.options.onEscape?.(this.el.value);
			} else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				this.options.onSubmit?.(this.el.value);
			}
		});
	}

	private autosize(): void {
		this.el.style.height = "auto";
		this.el.style.height = `${this.el.scrollHeight}px`;
	}

	focus(): void {
		this.el.focus();
		const len = this.el.value.length;
		this.el.setSelectionRange(len, len);
	}

	getValue(): string {
		return this.el.value;
	}

	setCursorToClick(): void {
		this.focus();
	}

	destroy(): void {
		this.el.remove();
	}
}

// --- Public factory ---------------------------------------------------------

export function createCardEditor(
	app: App,
	container: HTMLElement,
	options: CardEditorOptions,
): CardEditorHandle {
	const Cls = getEditorClass(app);
	if (Cls) {
		try {
			return new Cls(app, container, options);
		} catch (e) {
			console.error("Cards: failed to construct embedded editor, using textarea.", e);
		}
	}
	return new TextareaEditor(container, options);
}
