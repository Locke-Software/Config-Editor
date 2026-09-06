import * as vscode from 'vscode';

/** Supported on-disk config file formats. */
export type ConfigFormat = 'json' | 'properties';

/**
 * Ordered key/value pairs. A plain Map is used (instead of a plain object)
 * so insertion order - and therefore the row order shown in the table - is preserved.
 */
export type ConfigEntries = Map<string, string>;

/** Picks a parser/serializer based on the file extension. */
export function detectFormat(uri: vscode.Uri): ConfigFormat {
	return uri.path.toLowerCase().endsWith('.json') ? 'json' : 'properties';
}

export function parseConfig(text: string, format: ConfigFormat): ConfigEntries {
	return format === 'json' ? parseJson(text) : parseProperties(text);
}

export function serializeConfig(entries: ConfigEntries, format: ConfigFormat): string {
	return format === 'json' ? serializeJson(entries) : serializeProperties(entries);
}

// ---------------------------------------------------------------------------
// properties / .env / .ini style: one "key=value" (or "key: value") per line.
// Blank lines and lines starting with # or ; are treated as comments and dropped.
// ---------------------------------------------------------------------------

function parseProperties(text: string): ConfigEntries {
	const entries: ConfigEntries = new Map();
	const lines = text.split(/\r\n|\r|\n/);
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';') || trimmed.startsWith('[')) {
			continue;
		}
		const separatorIndex = findSeparator(trimmed);
		if (separatorIndex === -1) {
			continue;
		}
		const key = trimmed.slice(0, separatorIndex).trim();
		const value = trimmed.slice(separatorIndex + 1).trim();
		if (key) {
			entries.set(key, value);
		}
	}
	return entries;
}

function findSeparator(line: string): number {
	const eq = line.indexOf('=');
	const colon = line.indexOf(':');
	if (eq === -1) { return colon; }
	if (colon === -1) { return eq; }
	return Math.min(eq, colon);
}

function serializeProperties(entries: ConfigEntries): string {
	const lines: string[] = [];
	for (const [key, value] of entries) {
		lines.push(`${key}=${value}`);
	}
	return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// JSON: nested objects are flattened to dot-separated keys (e.g. "db.host")
// so every leaf value gets its own row in the table.
// ---------------------------------------------------------------------------

function parseJson(text: string): ConfigEntries {
	const entries: ConfigEntries = new Map();
	if (!text.trim()) {
		return entries;
	}
	const data = JSON.parse(text);
	flatten(data, '', entries);
	return entries;
}

function flatten(value: unknown, prefix: string, out: ConfigEntries): void {
	if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
		for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
			flatten(child, prefix ? `${prefix}.${key}` : key, out);
		}
		return;
	}
	out.set(prefix, value === undefined ? '' : String(value));
}

function serializeJson(entries: ConfigEntries): string {
	const root: Record<string, unknown> = {};
	for (const [dottedKey, value] of entries) {
		setDeep(root, dottedKey.split('.'), coerce(value));
	}
	return JSON.stringify(root, null, 2) + '\n';
}

function setDeep(root: Record<string, unknown>, path: string[], value: unknown): void {
	let node = root;
	for (let i = 0; i < path.length - 1; i++) {
		const segment = path[i];
		if (typeof node[segment] !== 'object' || node[segment] === null || Array.isArray(node[segment])) {
			node[segment] = {};
		}
		node = node[segment] as Record<string, unknown>;
	}
	node[path[path.length - 1]] = value;
}

/** Converts an edited string value back to a JSON-friendly primitive when possible. */
function coerce(value: string): unknown {
	if (value === 'true') { return true; }
	if (value === 'false') { return false; }
	if (value !== '' && !Number.isNaN(Number(value))) { return Number(value); }
	return value;
}
