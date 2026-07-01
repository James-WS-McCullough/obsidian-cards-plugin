/**
 * Polyfills for the DOM-builder helpers Obsidian adds to HTMLElement
 * (createDiv/createEl/createSpan/empty/addClass/…) plus the global creators, so
 * the view code runs unmodified under jsdom.
 */

type ElOpts =
	| string
	| {
			cls?: string | string[];
			text?: string;
			type?: string;
			attr?: Record<string, string>;
	  };

function applyOpts(el: HTMLElement, o?: ElOpts): HTMLElement {
	if (!o) return el;
	if (typeof o === "string") {
		el.className = o;
		return el;
	}
	if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(" ") : o.cls;
	if (o.text != null) el.textContent = o.text;
	if (o.type) el.setAttribute("type", o.type);
	if (o.attr) for (const k of Object.keys(o.attr)) el.setAttribute(k, o.attr[k]);
	return el;
}

function createEl(tag: string, o?: ElOpts): HTMLElement {
	return applyOpts(document.createElement(tag), o);
}

const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
proto.createEl = function (this: HTMLElement, tag: string, o?: ElOpts) {
	const el = createEl(tag, o);
	this.appendChild(el);
	return el;
};
proto.createDiv = function (this: HTMLElement, o?: ElOpts) {
	return (this as unknown as { createEl: typeof createEl }).createEl("div", o);
};
proto.createSpan = function (this: HTMLElement, o?: ElOpts) {
	return (this as unknown as { createEl: typeof createEl }).createEl("span", o);
};
proto.empty = function (this: HTMLElement) {
	while (this.firstChild) this.removeChild(this.firstChild);
};
proto.addClass = function (this: HTMLElement, ...cls: string[]) {
	this.classList.add(...cls);
};
proto.removeClass = function (this: HTMLElement, ...cls: string[]) {
	this.classList.remove(...cls);
};
proto.toggleClass = function (this: HTMLElement, cls: string, on: boolean) {
	this.classList.toggle(cls, on);
};
proto.setText = function (this: HTMLElement, t: string) {
	this.textContent = t;
};

const g = globalThis as unknown as Record<string, unknown>;
g.createEl = createEl;
g.createDiv = (o?: ElOpts) => createEl("div", o);
g.createSpan = (o?: ElOpts) => createEl("span", o);

if (!g.requestAnimationFrame) {
	g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(0), 0);
}
