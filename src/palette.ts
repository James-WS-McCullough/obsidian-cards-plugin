/**
 * Pure helper for the global recent-colours palette: prepend a colour, dedupe
 * case-insensitively, and cap the list. Kept separate from the Plugin class so
 * it can be unit-tested without Obsidian.
 */
export function addRecentColor(list: string[], color: string, max = 4): string[] {
	const next = list.filter((c) => c.toLowerCase() !== color.toLowerCase());
	next.unshift(color);
	return next.slice(0, max);
}
