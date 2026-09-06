import * as vscode from 'vscode';

/** Supported on-disk config file formats. */
export type ConfigFormat = 'json' | 'yaml' | 'ini' | 'properties';

/**
 * Ordered key/value pairs. A plain Map is used (instead of a plain object)
 * so insertion order - and therefore the row order shown in the table - is preserved.
 */
export type ConfigEntries = Map<string, string>;

/** Picks a parser/serializer based on the file extension. */
export function detectFormat(uri: vscode.Uri): ConfigFormat {
	const ext = uri.path.toLowerCase().split('.').pop() ?? '';
	if (ext === 'json') {
		return 'json';
	}
	if (ext === 'yaml' || ext === 'yml') {
		return 'yaml';
	}
	if (ext === 'ini') {
		return 'ini';
	}
	return 'properties'; // .env, .properties, .cfg, .conf, .txt, and anything else
}

export function parseConfig(text: string, format: ConfigFormat): ConfigEntries {
	switch (format) {
		case 'json': return parseJson(text);
		case 'yaml': return parseYaml(text);
		case 'ini': return parseIni(text);
		default: return parseProperties(text);
	}
}

export function serializeConfig(entries: ConfigEntries, format: ConfigFormat): string {
	switch (format) {
		case 'json': return serializeJson(entries);
		case 'yaml': return serializeYaml(entries);
		case 'ini': return serializeIni(entries);
		default: return serializeProperties(entries);
	}
}

// ---------------------------------------------------------------------------
// properties / .env style: one "key=value" (or "key: value") per line, no
// sections. Blank lines and lines starting with # or ; are comments.
// ---------------------------------------------------------------------------

function parseProperties(text: string): ConfigEntries {
	const entries: ConfigEntries = new Map();
	const lines = text.split(/\r\n|\r|\n/);
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
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
// INI: "[section]" headers group the "key=value" lines under them into
// "section.key" entries, which maps directly onto our section/tree UI. Keys
// that appear before any section header stay top-level (no prefix).
// ---------------------------------------------------------------------------

function parseIni(text: string): ConfigEntries {
	const entries: ConfigEntries = new Map();
	const lines = text.split(/\r\n|\r|\n/);
	let section = '';
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
			continue;
		}
		const sectionMatch = /^\[(.+)\]$/.exec(trimmed);
		if (sectionMatch) {
			section = sectionMatch[1].trim();
			continue;
		}
		const separatorIndex = findSeparator(trimmed);
		if (separatorIndex === -1) {
			continue;
		}
		const key = trimmed.slice(0, separatorIndex).trim();
		const value = trimmed.slice(separatorIndex + 1).trim();
		if (key) {
			entries.set(section ? `${section}.${key}` : key, value);
		}
	}
	return entries;
}

function serializeIni(entries: ConfigEntries): string {
	const bySection = new Map<string, [string, string][]>();
	for (const [dottedKey, value] of entries) {
		const dotIndex = dottedKey.indexOf('.');
		const section = dotIndex === -1 ? '' : dottedKey.slice(0, dotIndex);
		const key = dotIndex === -1 ? dottedKey : dottedKey.slice(dotIndex + 1);
		if (!bySection.has(section)) {
			bySection.set(section, []);
		}
		bySection.get(section)!.push([key, value]);
	}

	const lines: string[] = [];
	for (const [key, value] of bySection.get('') ?? []) {
		lines.push(`${key}=${value}`);
	}
	for (const [section, pairs] of bySection) {
		if (section === '') {
			continue;
		}
		if (lines.length > 0) {
			lines.push('');
		}
		lines.push(`[${section}]`);
		for (const [key, value] of pairs) {
			lines.push(`${key}=${value}`);
		}
	}
	return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// YAML: indentation-based nested mappings, the common shape for simple config
// files - handled the same way as JSON (flattened to dot-paths). Lists and
// other non-mapping content aren't modeled structurally: the raw block is
// kept verbatim as an opaque string value so saving doesn't silently drop it.
// ---------------------------------------------------------------------------

function parseYaml(text: string): ConfigEntries {
	const entries: ConfigEntries = new Map();
	const lines = text
		.split(/\r\n|\r|\n/)
		.filter(line => line.trim() && !line.trim().startsWith('#'));

	const indentOf = (line: string) => line.length - line.trimStart().length;
	let cursor = 0;

	function parseBlock(minIndent: number, prefix: string): void {
		while (cursor < lines.length && indentOf(lines[cursor]) >= minIndent) {
			const line = lines[cursor];
			const trimmed = line.trim();
			const match = /^([^:]+):\s*(.*)$/.exec(trimmed);
			if (!match) {
				cursor++; // e.g. a list item with no owning key at this level - not modeled
				continue;
			}
			const key = match[1].trim().replace(/^["']|["']$/g, '');
			const path = prefix ? `${prefix}.${key}` : key;
			const inlineValue = match[2].trim();
			const indent = indentOf(line);
			cursor++;

			if (inlineValue !== '') {
				entries.set(path, unquoteYamlScalar(inlineValue));
				continue;
			}

			const blockIndent = cursor < lines.length ? indentOf(lines[cursor]) : -1;
			if (blockIndent <= indent) {
				entries.set(path, ''); // bare "key:" with no inline value or children
				continue;
			}

			const blockStart = cursor;
			const nextIsMapping = /^[^:#\s-][^:]*:/.test(lines[blockStart].trim());
			if (nextIsMapping) {
				parseBlock(blockIndent, path);
			} else {
				while (cursor < lines.length && indentOf(lines[cursor]) >= blockIndent) {
					cursor++;
				}
				entries.set(path, lines.slice(blockStart, cursor).join('\n'));
			}
		}
	}

	parseBlock(0, '');
	return entries;
}

function unquoteYamlScalar(value: string): string {
	if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\'')))) {
		return value.slice(1, -1);
	}
	return value;
}

function serializeYaml(entries: ConfigEntries): string {
	const root: Record<string, unknown> = {};
	for (const [dottedKey, value] of entries) {
		setDeep(root, dottedKey.split('.'), coerce(value));
	}
	return stringifyYaml(root, 0);
}

function stringifyYaml(node: Record<string, unknown>, depth: number): string {
	const indent = '  '.repeat(depth);
	const lines: string[] = [];
	for (const [key, value] of Object.entries(node)) {
		if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
			lines.push(`${indent}${key}:`);
			lines.push(stringifyYaml(value as Record<string, unknown>, depth + 1).replace(/\n$/, ''));
		} else if (typeof value === 'string' && value.includes('\n')) {
			lines.push(`${indent}${key}:`); // raw block captured by parseYaml, kept verbatim
			lines.push(value);
		} else {
			lines.push(`${indent}${key}: ${formatYamlScalar(value)}`);
		}
	}
	return lines.join('\n') + '\n';
}

function formatYamlScalar(value: unknown): string {
	if (typeof value === 'boolean' || typeof value === 'number') {
		return String(value);
	}
	const str = String(value ?? '');
	const needsQuoting = str === ''
		|| str === 'true' || str === 'false' || str === 'null'
		|| !Number.isNaN(Number(str))
		|| /^[\s'"#&*?|>%@`\-[\]{},]/.test(str)
		|| /:\s|\s#/.test(str);
	return needsQuoting ? JSON.stringify(str) : str;
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
