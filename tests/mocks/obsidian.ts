/**
 * Minimal mock of the `obsidian` module — only the surface the plugin touches.
 * Aliased in vitest.config.mts.
 */

export class Component {
	_loaded = false;
	private _children: Component[] = [];
	load(): void {
		if (this._loaded) return;
		this._loaded = true;
		this.onload();
	}
	onload(): void {}
	unload(): void {
		if (!this._loaded) return;
		this._loaded = false;
		this.onunload();
	}
	onunload(): void {}
	addChild<T extends Component>(c: T): T {
		this._children.push(c);
		c.load();
		return c;
	}
	removeChild<T extends Component>(c: T): T {
		this._children = this._children.filter((x) => x !== c);
		c.unload();
		return c;
	}
	register(): void {}
	registerEvent(): void {}
	registerDomEvent(): void {}
}

export class MarkdownRenderChild extends Component {
	containerEl: HTMLElement;
	constructor(containerEl: HTMLElement) {
		super();
		this.containerEl = containerEl;
	}
}

const TASK_RE = /^\s*[-*+]\s+\[([ xX])\]\s*(.*)$/;

export const MarkdownRenderer = {
	async render(
		_app: unknown,
		markdown: string,
		el: HTMLElement,
		_path: string,
		_comp: unknown,
	): Promise<void> {
		// Render task lines as real checkboxes (so checkbox-ordinal logic is
		// exercised); everything else as a paragraph.
		for (const line of markdown.split("\n")) {
			const m = line.match(TASK_RE);
			if (m) {
				const li = document.createElement("div");
				li.className = "task-list-item";
				const input = document.createElement("input");
				input.className = "task-list-item-checkbox";
				input.type = "checkbox";
				input.checked = m[1].toLowerCase() === "x";
				li.appendChild(input);
				const span = document.createElement("span");
				span.textContent = m[2];
				li.appendChild(span);
				el.appendChild(li);
			} else if (line.trim()) {
				const p = document.createElement("p");
				p.textContent = line;
				el.appendChild(p);
			}
		}
	},
};

export function setIcon(_el: HTMLElement, _icon: string): void {}

export class Notice {
	constructor(_message?: string | DocumentFragment, _duration?: number) {}
	hide(): void {}
}

export class Modal {
	app: unknown;
	contentEl: HTMLElement = document.createElement("div");
	constructor(app?: unknown) {
		this.app = app;
	}
	open(): void {
		this.onOpen();
	}
	close(): void {
		this.onClose();
	}
	onOpen(): void {}
	onClose(): void {}
}

export class TFile {
	path = "";
}

export class Scope {
	constructor(_parent?: unknown) {}
	register(): void {}
}

export class Plugin extends Component {
	app: unknown;
	constructor(app?: unknown) {
		super();
		this.app = app;
	}
	addCommand(): void {}
	registerMarkdownCodeBlockProcessor(): void {}
	loadData(): Promise<unknown> {
		return Promise.resolve(null);
	}
	saveData(): Promise<void> {
		return Promise.resolve();
	}
}

export type App = unknown;
export type Editor = unknown;
export type MarkdownPostProcessorContext = unknown;
