import { addIcon, Editor, MarkdownView, Notice, Plugin } from "obsidian";
import { CardStack } from "./cardStack";
import { addRecentColor } from "./palette";

const EMPTY_STACK = "```cards\n```\n";

/** Custom ribbon icon: three rounded cards stacked vertically. */
const CARDS_ICON_ID = "cards-stack";
const CARDS_ICON_SVG = `<g fill="none" stroke="currentColor" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">
<rect x="12" y="10" width="76" height="44" rx="9" />
<rect x="12" y="68" width="76" height="17" rx="7" />
<g stroke-width="5">
<line x1="23" y1="26" x2="71" y2="26" />
<line x1="23" y1="38" x2="59" y2="38" />
</g>
</g>`;

interface CardsSettings {
	/** Most-recently-used card colours, newest first, capped at 4. */
	recentColors: string[];
}

const DEFAULT_SETTINGS: CardsSettings = {
	recentColors: [],
};

const MAX_RECENT_COLORS = 4;

export default class CardsPlugin extends Plugin {
	settings: CardsSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		addIcon(CARDS_ICON_ID, CARDS_ICON_SVG);

		this.registerMarkdownCodeBlockProcessor("cards", (source, el, ctx) => {
			ctx.addChild(new CardStack(this, source, el, ctx));
		});

		this.addCommand({
			id: "insert-card-stack",
			name: "Add cards",
			editorCallback: (editor: Editor) => {
				editor.replaceSelection(EMPTY_STACK);
			},
		});

		this.addCommand({
			id: "new-card-stack-note",
			name: "New note with card stack",
			callback: () => {
				void this.createCardStackNote();
			},
		});

		this.addRibbonIcon(CARDS_ICON_ID, "Add cards", () => {
			// If a note is open with the cursor on a blank line, drop the stack
			// right there; otherwise start a fresh note with it.
			const editor =
				this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
			if (editor && this.cursorOnBlankLine(editor)) {
				editor.replaceSelection(EMPTY_STACK);
			} else {
				void this.createCardStackNote();
			}
		});

		// Right-click in the editor → "Insert card stack".
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor) => {
				menu.addItem((item) =>
					item
						.setTitle("Insert card stack")
						.setIcon(CARDS_ICON_ID)
						.setSection("insert")
						.onClick(() => editor.replaceSelection(EMPTY_STACK)),
				);
			}),
		);
	}

	/** True when there's no selection and the cursor's line is empty. */
	private cursorOnBlankLine(editor: Editor): boolean {
		if (editor.somethingSelected()) return false;
		const cursor = editor.getCursor();
		return editor.getLine(cursor.line).trim() === "";
	}

	/** Create a new note containing an empty card stack and open it. */
	async createCardStackNote(): Promise<void> {
		const path = this.uniqueNotePath("Cards");
		try {
			const file = await this.app.vault.create(path, EMPTY_STACK);
			await this.app.workspace.getLeaf(true).openFile(file);
		} catch (err) {
			new Notice("Couldn't create card stack note");
			console.error("Cards: failed to create note", err);
		}
	}

	/** Build a vault-root path like "Cards.md", bumping a counter on collision. */
	private uniqueNotePath(base: string): string {
		let path = `${base}.md`;
		let n = 1;
		while (this.app.vault.getAbstractFileByPath(path)) {
			path = `${base} ${n++}.md`;
		}
		return path;
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Record a colour as most-recently-used (deduped, newest first, capped). */
	addRecentColor(color: string): void {
		this.settings.recentColors = addRecentColor(
			this.settings.recentColors,
			color,
			MAX_RECENT_COLORS,
		);
		void this.saveSettings();
	}
}
