import {
	App,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	MarkdownRenderer,
	Modal,
	Notice,
	setIcon,
} from "obsidian";
import Sortable from "sortablejs";

import type CardsPlugin from "./main";
import { Card, parseStack, serializeStack, toggleTaskInCard } from "./parser";
import { replaceCardBlockBody, writeCardBlock } from "./persistence";
import { CardEditorHandle, createCardEditor } from "./embeddableEditor";

/** How long the "Undo" toast stays on screen (ms). */
const UNDO_TIMEOUT = 8000;

/**
 * Renders one ```cards block: a vertically-stacked, drag-reorderable set of
 * full-width cards, each holding its own markdown and optional colour.
 *
 * State model: `this.cards` is the single in-memory source of truth while the
 * block is mounted. Every mutation updates it, repaints the affected card(s)
 * optimistically for responsiveness, and persists to the note. Persistence may
 * trigger Obsidian to re-run the processor (a fresh CardStack) — that rebuild is
 * idempotent against the same `cards`, so the two paths converge.
 */
export class CardStack extends MarkdownRenderChild {
	private app: App;
	private cards: Card[] = [];
	/** Markdown new cards in this stack are pre-filled with; null = blank. */
	private template: string | null = null;
	private gearEl: HTMLElement | null = null;
	private cardEls: HTMLElement[] = [];
	private cardComponents: Array<MarkdownRenderChild | null> = [];

	private listEl!: HTMLElement;
	private sortable: Sortable | null = null;

	private editingIndex: number | null = null;
	private editHandle: CardEditorHandle | null = null;
	private justAdded: number | null = null;

	private colorPopover: HTMLElement | null = null;
	private colorPopoverCleanup: (() => void) | null = null;

	constructor(
		private plugin: CardsPlugin,
		private source: string,
		containerEl: HTMLElement,
		private ctx: MarkdownPostProcessorContext,
	) {
		super(containerEl);
		this.app = plugin.app;
	}

	onload(): void {
		const stack = parseStack(this.source);
		this.template = stack.template;
		this.cards = stack.cards;

		this.containerEl.empty();
		this.containerEl.addClass("cards-stack");
		this.listEl = this.containerEl.createDiv({ cls: "cards-list" });

		this.renderCards();
		this.renderAddButton();
		this.setupSortable();
	}

	onunload(): void {
		this.closeColorPopover();
		this.sortable?.destroy();
		this.sortable = null;
		this.editHandle?.destroy();
		this.editHandle = null;
	}

	// --- Rendering ----------------------------------------------------------

	private renderCards(): void {
		this.closeColorPopover();
		this.clearComponents();
		this.listEl.empty();
		this.cardEls = [];

		this.cards.forEach((_, i) => {
			const el = this.buildCardEl(i);
			this.cardEls[i] = el;
			this.listEl.appendChild(el);
		});
	}

	/** Rebuild a single card element in place, leaving its neighbours untouched. */
	private renderSingleCard(index: number): void {
		const old = this.cardEls[index];
		if (!old) return;
		if (this.cardComponents[index]) {
			this.removeChild(this.cardComponents[index]!);
			this.cardComponents[index] = null;
		}
		const fresh = this.buildCardEl(index);
		this.cardEls[index] = fresh;
		old.replaceWith(fresh);
	}

	private buildCardEl(index: number): HTMLElement {
		const card = createDiv({ cls: "cards-card" });
		card.dataset.index = String(index);

		if (this.cards[index].highlight) card.addClass("cards-card--highlight");

		const handle = card.createDiv({ cls: "cards-handle" });
		setIcon(handle, "grip-vertical");
		handle.setAttribute("aria-label", "Drag to reorder");

		const content = card.createDiv({ cls: "cards-card-content" });
		this.fillCardContent(index, content);
		content.addEventListener("click", (e) => this.onCardClick(index, content, e));

		// Right-edge buttons (top → bottom): delete, colour, insert-below.
		const del = card.createDiv({ cls: "cards-btn cards-delete" });
		setIcon(del, "x");
		del.setAttribute("aria-label", "Delete card");
		del.addEventListener("click", (e) => {
			e.stopPropagation();
			this.deleteCard(index);
		});

		const paint = card.createDiv({ cls: "cards-btn cards-paint" });
		setIcon(paint, "paintbrush");
		paint.setAttribute("aria-label", "Card colour");
		paint.addEventListener("click", (e) => {
			e.stopPropagation();
			this.openColorPopover(index, paint);
		});

		const add = card.createDiv({ cls: "cards-btn cards-add-below" });
		setIcon(add, "plus");
		add.setAttribute("aria-label", "Insert card below");
		add.addEventListener("click", (e) => {
			e.stopPropagation();
			this.insertCardBelow(index);
		});

		// Preview line shown below the card while hovering the insert-below button.
		card.createDiv({ cls: "cards-insert-line" });

		// Colour strip at the bottom of the card.
		if (this.cards[index].color) {
			const strip = card.createDiv({ cls: "cards-color-strip" });
			strip.style.backgroundColor = this.cards[index].color!;
		}

		return card;
	}

	private renderAddButton(): void {
		const row = this.containerEl.createDiv({ cls: "cards-add-row" });

		const btn = row.createDiv({ cls: "cards-add" });
		setIcon(btn.createSpan({ cls: "cards-add-icon" }), "plus");
		btn.createSpan({ text: "Add card" });
		btn.addEventListener("click", () => this.addCard());

		// Gear: configure the markdown new cards in this list start with.
		const gear = row.createDiv({ cls: "cards-template-btn" });
		setIcon(gear, "settings-2");
		gear.setAttribute("aria-label", "Set the template for new cards in this list");
		gear.classList.toggle("is-set", this.template != null);
		gear.addEventListener("click", (e) => {
			e.stopPropagation();
			this.openTemplateEditor();
		});
		this.gearEl = gear;
	}

	/** A blank card, or one pre-filled from this stack's template. */
	private newCard(): Card {
		return { text: this.template ?? "", color: null, highlight: false };
	}

	private openTemplateEditor(): void {
		new TemplateModal(this.app, this.template ?? "", (value) => {
			const next = value.trim() === "" ? null : value;
			if (next === this.template) return;
			this.template = next;
			this.gearEl?.classList.toggle("is-set", this.template != null);
			void this.persist();
		}).open();
	}

	/** Render a card's rendered (non-editing) content into an existing content
	 *  element, without rebuilding the surrounding card. */
	private fillCardContent(index: number, content: HTMLElement): void {
		content.empty();
		content.removeClass("is-editing");
		const md = this.cards[index].text;
		if (md.trim() === "") {
			content.addClass("is-empty");
			content.createSpan({ cls: "cards-placeholder", text: "Empty card — click to edit" });
		} else {
			content.removeClass("is-empty");
			const rc = new MarkdownRenderChild(content);
			this.addChild(rc);
			this.cardComponents[index] = rc;
			MarkdownRenderer.render(this.app, md, content, this.ctx.sourcePath, rc);
		}
	}

	private clearComponents(): void {
		for (const c of this.cardComponents) {
			if (c) this.removeChild(c);
		}
		this.cardComponents = [];
	}

	// --- Interaction --------------------------------------------------------

	private onCardClick(index: number, content: HTMLElement, e: MouseEvent): void {
		// While this card is being edited, the content is the live editor — let it
		// handle its own clicks (including native checkbox toggling). Running our
		// display-mode handlers here would flip the pre-edit text and rebuild the
		// card, discarding the in-progress edit.
		if (this.editingIndex === index) return;

		const target = e.target as HTMLElement;

		const checkbox = target.closest("input.task-list-item-checkbox");
		if (checkbox) {
			e.preventDefault();
			this.toggleCheckbox(index, content, checkbox as HTMLInputElement);
			return;
		}

		// Let links behave like links.
		if (target.closest("a")) return;

		if (this.editingIndex === index) return;
		this.enterEdit(index, e.clientX, e.clientY);
	}

	private toggleCheckbox(index: number, content: HTMLElement, checkbox: HTMLInputElement): void {
		const boxes = Array.from(content.querySelectorAll("input.task-list-item-checkbox"));
		const ordinal = boxes.indexOf(checkbox);
		if (ordinal === -1) return;

		this.cards[index].text = toggleTaskInCard(this.cards[index].text, ordinal);
		this.renderSingleCard(index);
		void this.persist();
	}

	// --- Editing ------------------------------------------------------------

	private enterEdit(index: number, x?: number, y?: number): void {
		if (this.editingIndex !== null && this.editingIndex !== index) {
			this.commitEdit(this.editingIndex, this.editHandle?.getValue() ?? this.cards[this.editingIndex].text);
		}
		this.editingIndex = index;

		const card = this.cardEls[index];
		if (this.cardComponents[index]) {
			this.removeChild(this.cardComponents[index]!);
			this.cardComponents[index] = null;
		}

		const content = card.querySelector(".cards-card-content") as HTMLElement;
		content.empty();
		content.removeClass("is-empty");
		content.addClass("is-editing");

		this.editHandle = createCardEditor(this.app, content, {
			value: this.cards[index].text,
			placeholder: "Write markdown…",
			onBlur: (v) => this.commitEdit(index, v),
			onSubmit: (v) => this.commitEdit(index, v),
			onEscape: (v) => this.commitEdit(index, v),
		});

		if (x != null && y != null) this.editHandle.setCursorToClick(x, y);
		else this.editHandle.focus();
	}

	private commitEdit(index: number, value: string): void {
		if (this.editingIndex !== index) return; // already committed / re-entrant
		this.editingIndex = null;

		const handle = this.editHandle;
		this.editHandle = null;
		const changed = value !== this.cards[index].text;
		handle?.destroy();

		// A freshly-added card left empty is discarded rather than persisted.
		if (this.justAdded === index && value.trim() === "" && this.cards[index].text.trim() === "") {
			this.justAdded = null;
			this.cards.splice(index, 1);
			this.renderCards();
			return;
		}
		this.justAdded = null;

		this.cards[index].text = value;
		const content = this.cardEls[index]?.querySelector(".cards-card-content") as HTMLElement | null;
		if (content) this.fillCardContent(index, content);
		if (changed) void this.persist();
	}

	/**
	 * Tear down the active editor, writing its current value into `cards`,
	 * without rebuilding the DOM (the caller, e.g. a drag, will rebuild). Used
	 * when an edit must be committed mid-interaction without a re-render.
	 */
	private flushActiveEdit(): void {
		if (this.editingIndex === null) return;
		const index = this.editingIndex;
		const value = this.editHandle?.getValue() ?? this.cards[index].text;
		this.editingIndex = null;
		this.justAdded = null;
		this.editHandle?.destroy();
		this.editHandle = null;
		this.cards[index].text = value;
		// Restore rendered content in place so the card isn't blank during the
		// interaction that triggered the flush (e.g. a drag of another card).
		const content = this.cardEls[index]?.querySelector(".cards-card-content") as HTMLElement | null;
		if (content) this.fillCardContent(index, content);
	}

	// --- Structural mutations ----------------------------------------------

	private addCard(): void {
		const index = this.cards.length;
		this.cards.push(this.newCard());
		this.justAdded = index;
		this.renderCards();
		this.enterEdit(index);
	}

	private insertCardBelow(index: number): void {
		const at = index + 1;
		this.cards.splice(at, 0, this.newCard());
		this.justAdded = at;
		this.renderCards();
		this.enterEdit(at);
	}

	private deleteCard(index: number): void {
		if (this.editingIndex === index) {
			this.editingIndex = null;
			this.editHandle?.destroy();
			this.editHandle = null;
		}
		const before = this.source;
		this.cards.splice(index, 1);
		this.renderCards();
		void this.persist(); // sets this.source synchronously to the new body
		this.offerUndo(before, this.source, "Card deleted");
	}

	private setupSortable(): void {
		this.sortable = Sortable.create(this.listEl, {
			handle: ".cards-handle",
			animation: 150,
			ghostClass: "cards-card--ghost",
			chosenClass: "cards-card--chosen",
			dragClass: "cards-card--drag",
			// Capture any in-progress edit into `cards` before the drag reorders
			// the array, otherwise the edit would be lost on reorder + rebuild.
			onStart: () => {
				this.containerEl.addClass("is-dragging");
				this.flushActiveEdit();
			},
			onEnd: () => {
				this.containerEl.removeClass("is-dragging");
				this.onSortEnd();
			},
		});
	}

	private onSortEnd(): void {
		// Read the new visual order from the DOM, remap, then rebuild on the next
		// tick so we don't mutate the list while Sortable is finishing its drag.
		const order = Array.from(this.listEl.children).map((c) =>
			Number((c as HTMLElement).dataset.index),
		);
		if (order.some((n) => Number.isNaN(n))) return;

		// Reordering is fully reversible by dragging, so we don't offer an undo toast.
		this.cards = order.map((i) => this.cards[i]);
		void this.persist(); // sets this.source synchronously to the new body
		window.setTimeout(() => this.renderCards(), 0);
	}

	/**
	 * Show a one-tap "Undo" toast for a structural change. The handler restores
	 * the previous body by locating the block via its current content, so it
	 * survives the re-render that persisting may trigger (which would otherwise
	 * leave us holding a stale element).
	 */
	private offerUndo(fromBody: string, toBody: string, label: string): void {
		if (fromBody === toBody) return;

		const frag = document.createDocumentFragment();
		frag.appendChild(document.createTextNode(`${label}. `));
		const link = document.createElement("a");
		link.className = "cards-undo-link";
		link.textContent = "Undo";
		frag.appendChild(link);

		const notice = new Notice(frag, UNDO_TIMEOUT);
		link.addEventListener("click", () => {
			notice.hide();
			void this.undo(fromBody, toBody);
		});
	}

	private async undo(fromBody: string, toBody: string): Promise<void> {
		const ok = await replaceCardBlockBody(
			this.app,
			this.ctx.sourcePath,
			toBody,
			fromBody,
		);
		if (!ok) {
			new Notice("Cards: couldn't undo — the list has changed since.");
		}
	}

	// --- Colour -------------------------------------------------------------

	private setCardColor(index: number, color: string | null): void {
		this.cards[index].color = color;
		if (color) this.plugin.addRecentColor(color);
		this.renderSingleCard(index);
		void this.persist();
	}

	private setCardHighlight(index: number, highlight: boolean): void {
		this.cards[index].highlight = highlight;
		this.renderSingleCard(index);
		void this.persist();
	}

	private openColorPopover(index: number, anchor: HTMLElement): void {
		this.closeColorPopover();
		const current = this.cards[index].color;

		const pop = document.body.createDiv({ cls: "cards-color-popover" });

		const recents = this.plugin.settings.recentColors;
		if (recents.length > 0) {
			const row = pop.createDiv({ cls: "cards-swatch-row" });
			for (const c of recents) this.addSwatch(row, c, index);
		}

		const actions = pop.createDiv({ cls: "cards-swatch-row" });

		// Custom colour via the OS picker (the swatch itself is the input).
		const input = actions.createEl("input", {
			cls: "cards-swatch cards-color-input",
			attr: { type: "color" },
		});
		input.value = current ?? "#888888";
		input.setAttribute("aria-label", "Custom colour");
		// `change` (not `input`) so we commit the colour the user confirms in the
		// OS picker, not the intermediate values it streams while dragging.
		input.addEventListener("change", () => {
			this.setCardColor(index, input.value);
			this.closeColorPopover();
		});

		// Clear colour.
		const clear = actions.createDiv({ cls: "cards-swatch cards-swatch-clear" });
		setIcon(clear, "ban");
		clear.setAttribute("aria-label", "No colour");
		clear.addEventListener("click", () => {
			this.setCardColor(index, null);
			this.closeColorPopover();
		});

		// Background highlight toggle.
		const hlRow = pop.createDiv({ cls: "cards-toggle-row" });
		hlRow.createSpan({ cls: "cards-toggle-label", text: "Highlight" });
		const sw = hlRow.createDiv({ cls: "cards-switch" });
		if (this.cards[index].highlight) sw.addClass("is-on");
		hlRow.addEventListener("click", () => {
			this.setCardHighlight(index, !this.cards[index].highlight);
			this.closeColorPopover();
		});

		this.positionPopover(pop, anchor);

		const onDown = (e: MouseEvent) => {
			const t = e.target as Node;
			if (!pop.contains(t) && !anchor.contains(t)) this.closeColorPopover();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") this.closeColorPopover();
		};
		// Defer registration so the opening click doesn't immediately close it.
		window.setTimeout(() => {
			document.addEventListener("mousedown", onDown, true);
			document.addEventListener("keydown", onKey, true);
		}, 0);

		this.colorPopover = pop;
		this.colorPopoverCleanup = () => {
			document.removeEventListener("mousedown", onDown, true);
			document.removeEventListener("keydown", onKey, true);
			pop.remove();
		};
	}

	private addSwatch(row: HTMLElement, color: string, index: number): void {
		const sw = row.createDiv({ cls: "cards-swatch" });
		sw.style.backgroundColor = color;
		sw.setAttribute("aria-label", color);
		sw.addEventListener("click", () => {
			this.setCardColor(index, color);
			this.closeColorPopover();
		});
	}

	private positionPopover(pop: HTMLElement, anchor: HTMLElement): void {
		const r = anchor.getBoundingClientRect();
		pop.style.position = "fixed";
		pop.style.top = `${r.bottom + 4}px`;
		pop.style.left = `${r.left}px`;
		// Nudge back on-screen once measured.
		window.requestAnimationFrame(() => {
			const pr = pop.getBoundingClientRect();
			if (pr.right > window.innerWidth - 8) {
				pop.style.left = `${Math.max(8, window.innerWidth - 8 - pr.width)}px`;
			}
			if (pr.bottom > window.innerHeight - 8) {
				pop.style.top = `${Math.max(8, r.top - 4 - pr.height)}px`;
			}
		});
	}

	private closeColorPopover(): void {
		this.colorPopoverCleanup?.();
		this.colorPopoverCleanup = null;
		this.colorPopover = null;
	}

	// --- Persistence --------------------------------------------------------

	private async persist(): Promise<void> {
		this.source = serializeStack(this.template, this.cards);
		await writeCardBlock(this.app, this.ctx, this.containerEl, this.source);
	}
}

/** Modal for editing the markdown that new cards in a stack are seeded with. */
class TemplateModal extends Modal {
	constructor(
		app: App,
		private initial: string,
		private onSubmit: (value: string) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("cards-template-modal");
		contentEl.createEl("h3", { text: "New-card template" });
		contentEl.createEl("p", {
			cls: "cards-template-hint",
			text: "New cards in this list start with this markdown. Leave it empty for blank cards.",
		});

		const input = contentEl.createEl("textarea", {
			cls: "cards-template-input",
		});
		input.value = this.initial;
		input.rows = 10;

		const actions = contentEl.createDiv({ cls: "cards-template-actions" });
		const save = actions.createEl("button", { text: "Save", cls: "mod-cta" });
		save.addEventListener("click", () => {
			this.onSubmit(input.value);
			this.close();
		});
		const cancel = actions.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.close());

		window.setTimeout(() => input.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
