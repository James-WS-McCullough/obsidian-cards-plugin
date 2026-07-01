/**
 * Conversion between the raw body of a ```cards fenced block and an array of
 * cards. Each card carries its own markdown plus an optional colour (shown as a
 * strip at the bottom of the card).
 *
 * Cards are separated by a line that, trimmed, is exactly `---` (a markdown
 * thematic break on its own line). If a card needs a horizontal rule in its own
 * content, use `***` or `___` instead, both of which are valid markdown.
 *
 * A card's colour is persisted as a leading HTML comment, e.g.
 *   <!-- cards-color: #e0533d -->
 * which is invisible in normal Obsidian rendering and stays attached to the
 * card's text through reordering. It is stripped before the text is rendered or
 * edited, and re-added on serialize.
 */

export interface Card {
	text: string;
	color: string | null;
	highlight: boolean;
}

const SEPARATOR = /^[ \t]*---[ \t]*$/;
const JOIN = "\n\n---\n\n";
const COLOR_MARKER = /^<!--\s*cards-color:\s*(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)\s*-->\s*$/;
const HIGHLIGHT_MARKER = /^<!--\s*cards-highlight\s*-->\s*$/i;
const TEMPLATE_MARKER = /^<!--\s*cards-template\s*-->\s*$/i;

/** Remove leading/trailing blank lines but preserve internal whitespace. */
function trimBlankEdges(text: string): string {
	return text.replace(/^\s*\n/, "").replace(/\n\s*$/, "");
}

function chunkToCard(chunk: string): Card {
	const lines = trimBlankEdges(chunk).split("\n");
	let color: string | null = null;
	let highlight = false;

	// Consume any recognized leading metadata markers, in any order.
	while (lines.length > 0) {
		const cm = lines[0].match(COLOR_MARKER);
		if (cm) {
			color = cm[1];
			lines.shift();
			continue;
		}
		if (HIGHLIGHT_MARKER.test(lines[0])) {
			highlight = true;
			lines.shift();
			continue;
		}
		break;
	}

	return { text: trimBlankEdges(lines.join("\n")), color, highlight };
}

function serializeCard(card: Card): string {
	const markers: string[] = [];
	if (card.highlight) markers.push(`<!-- cards-highlight -->`);
	if (card.color) markers.push(`<!-- cards-color: ${card.color} -->`);
	const text = trimBlankEdges(card.text);
	return markers.length > 0 ? `${markers.join("\n")}\n${text}` : text;
}

/** Split a block body into card-sized chunks on `---` separator lines. */
function splitChunks(source: string): string[] {
	const chunks: string[] = [];
	let current: string[] = [];
	for (const line of source.split("\n")) {
		if (SEPARATOR.test(line)) {
			chunks.push(current.join("\n"));
			current = [];
		} else {
			current.push(line);
		}
	}
	chunks.push(current.join("\n"));
	return chunks;
}

/** Parse a fenced-block body into an array of cards. */
export function parseCards(source: string): Card[] {
	if (source.trim() === "") {
		return [];
	}
	return splitChunks(source).map(chunkToCard);
}

/** Serialize an array of cards back into a fenced-block body. */
export function serializeCards(cards: Card[]): string {
	return cards.map(serializeCard).join(JOIN);
}

/**
 * A whole ```cards block: its cards plus an optional per-stack template used to
 * pre-fill newly added cards.
 */
export interface Stack {
	/** Markdown each new card in this stack starts with; null = blank cards. */
	template: string | null;
	cards: Card[];
}

/**
 * Parse a fenced-block body into its optional new-card template plus its cards.
 * The template is stored as a leading chunk whose first line is the
 * `<!-- cards-template -->` marker; it is consumed here rather than rendered as
 * a card. Only the very first chunk is treated as a template.
 */
export function parseStack(source: string): Stack {
	if (source.trim() === "") {
		return { template: null, cards: [] };
	}

	const chunks = splitChunks(source);
	let template: string | null = null;

	const firstLines = trimBlankEdges(chunks[0]).split("\n");
	if (TEMPLATE_MARKER.test(firstLines[0])) {
		const body = trimBlankEdges(firstLines.slice(1).join("\n"));
		template = body === "" ? null : body;
		chunks.shift();
	}

	return { template, cards: chunks.map(chunkToCard) };
}

/** Serialize a per-stack template + cards back into a fenced-block body. */
export function serializeStack(template: string | null, cards: Card[]): string {
	const body = serializeCards(cards);
	if (!template || template.trim() === "") {
		return body;
	}
	const head = `<!-- cards-template -->\n${trimBlankEdges(template)}`;
	return cards.length > 0 ? `${head}${JOIN}${body}` : head;
}

/**
 * Toggle the checkbox of the `ordinal`-th task-list item (0-based, in source
 * order) within a card's markdown, flipping `[ ]` <-> `[x]`. Returns the text
 * unchanged if no such task exists.
 */
const TASK_LINE = /^(\s*[-*+]\s+\[)([ xX])(\].*)$/;

export function toggleTaskInCard(text: string, ordinal: number): string {
	const lines = text.split("\n");
	let count = -1;
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(TASK_LINE);
		if (!m) continue;
		count++;
		if (count === ordinal) {
			const flipped = m[2] === " " ? "x" : " ";
			lines[i] = m[1] + flipped + m[3];
			break;
		}
	}
	return lines.join("\n");
}
