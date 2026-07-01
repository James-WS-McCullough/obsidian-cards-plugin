import { App, MarkdownPostProcessorContext, Notice, TFile } from "obsidian";

/**
 * Replace the lines strictly between the fences (lineStart = opening ```cards
 * line, lineEnd = closing ``` line) of a document with a new block body. Pure
 * and string-only so it can be unit-tested without a vault.
 */
export function spliceCardBlock(
	data: string,
	lineStart: number,
	lineEnd: number,
	newBody: string,
): string {
	const lines = data.split("\n");
	const before = lines.slice(0, lineStart + 1); // through opening fence
	const after = lines.slice(lineEnd); // closing fence onward
	return [...before, ...newBody.split("\n"), ...after].join("\n");
}

/**
 * Replace the body of the ```cards fenced block this element renders, in the
 * source file, with `newBody`.
 *
 * Locating strategy: `ctx.getSectionInfo(el)` gives the line range of the whole
 * fenced block (the opening ```cards line through the closing ``` line). We swap
 * only the lines strictly between those fences, so multiple identical blocks in
 * one note never collide — we always target this block's exact line range.
 *
 * Uses `Vault.process` (atomic read-modify-write) to avoid the lost-update race
 * that `read` + `modify` is prone to. `getSectionInfo` can return null in some
 * states (e.g. before a section is laid out); we bail safely rather than risk
 * writing to the wrong place.
 */
export async function writeCardBlock(
	app: App,
	ctx: MarkdownPostProcessorContext,
	el: HTMLElement,
	newBody: string,
): Promise<boolean> {
	const file = app.vault.getAbstractFileByPath(ctx.sourcePath);
	if (!(file instanceof TFile)) {
		return false;
	}

	let wrote = false;
	await app.vault.process(file, (data) => {
		// Re-fetch section info at write time — line numbers shift as the doc
		// changes, so this must never be cached.
		const info = ctx.getSectionInfo(el);
		if (!info) {
			return data;
		}

		const next = spliceCardBlock(data, info.lineStart, info.lineEnd, newBody);
		if (next === data) {
			return data; // no-op; avoids a needless re-render
		}
		wrote = true;
		return next;
	});

	if (!wrote) {
		// Either nothing changed, or we couldn't locate the block.
		const info = ctx.getSectionInfo(el);
		if (!info) {
			new Notice("Cards: couldn't locate the card block to save changes.");
		}
	}

	return wrote;
}

/**
 * In `data`, find the first ```cards block whose body is exactly `fromBody` and
 * replace that body with `toBody`. Returns the new document, or null if no such
 * block exists.
 *
 * Used by undo, which has no live element to call `getSectionInfo` on (the block
 * may have re-rendered into a fresh instance since the change). Anchoring on the
 * exact body keeps this correct even when a card's own content contains nested
 * code fences — only the whole-body match between matching fences can succeed.
 */
export function replaceFirstCardBlock(
	data: string,
	fromBody: string,
	toBody: string,
): string | null {
	const lines = data.split("\n");
	const fromLines = fromBody.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const open = lines[i].match(/^(\s*)(`{3,})cards\s*$/);
		if (!open) continue;
		const closeIdx = i + 1 + fromLines.length;
		if (closeIdx >= lines.length) continue;
		const close = lines[closeIdx].match(/^(\s*)(`{3,})\s*$/);
		if (!close || close[2].length < open[2].length) continue;
		if (lines.slice(i + 1, closeIdx).join("\n") !== fromBody) continue;
		return [
			...lines.slice(0, i + 1),
			...toBody.split("\n"),
			...lines.slice(closeIdx),
		].join("\n");
	}
	return null;
}

/**
 * Restore a card block's body by content: find the block currently holding
 * `fromBody` and rewrite it to `toBody`. Atomic via `Vault.process`. Returns
 * false if the block can't be found (e.g. the list was changed again first).
 */
export async function replaceCardBlockBody(
	app: App,
	sourcePath: string,
	fromBody: string,
	toBody: string,
): Promise<boolean> {
	const file = app.vault.getAbstractFileByPath(sourcePath);
	if (!(file instanceof TFile)) {
		return false;
	}

	let ok = false;
	await app.vault.process(file, (data) => {
		const next = replaceFirstCardBlock(data, fromBody, toBody);
		if (next == null) {
			return data;
		}
		ok = true;
		return next;
	});
	return ok;
}
