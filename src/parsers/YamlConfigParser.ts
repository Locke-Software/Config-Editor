import { ConfigEntries, ConfigFormatParser } from './ConfigFormatParser';
import { buildNestedModel } from './nestedModel';

/**
 * YAML: indentation-based nested mappings/lists, the common shape for simple config files -
 * handled the same way as JSON (flattened to dot-paths, with array items addressed by their
 * index, e.g. "servers.0.host"). Flow-style ("[a, b]"/"{a: 1}") and block scalars ("|"/">")
 * aren't modeled: that raw text is kept verbatim as an opaque string value so saving doesn't
 * drop it.
 */
export class YamlConfigParser implements ConfigFormatParser {
	parse(text: string): ConfigEntries {
		const entries: ConfigEntries = new Map();
		const lines = text
			.split(/\r\n|\r|\n/)
			.filter(line => line.trim() && !line.trim().startsWith('#'));

		const indentOf = (line: string) => line.length - line.trimStart().length;
		/** A line is "structured" (worth recursing into) if it's a mapping key or a list item. */
		const isStructuredLine = (line: string) => /^[^:#\s-][^:]*:(\s|$)/.test(line) || /^-(\s|$)/.test(line);
		let cursor = 0;

		function parseBlock(minIndent: number, prefix: string): void {
			let arrayIndex = 0;
			while (cursor < lines.length && indentOf(lines[cursor]) >= minIndent) {
				const line = lines[cursor];
				const indent = indentOf(line);
				const trimmed = line.trim();

				const listMatch = /^-(?:\s+(.*))?$/.exec(trimmed);
				if (listMatch) {
					const path = prefix ? `${prefix}.${arrayIndex}` : String(arrayIndex);
					arrayIndex++;
					const rest = (listMatch[1] ?? '').trim();
					cursor++;
					parseListItem(rest, indent, path);
					continue;
				}

				const match = /^([^:]+):\s*(.*)$/.exec(trimmed);
				if (!match) {
					cursor++; // unrecognized line at this level (e.g. flow-style content) - not modeled
					continue;
				}
				const key = match[1].trim().replace(/^["']|["']$/g, '');
				const path = prefix ? `${prefix}.${key}` : key;
				const inlineValue = match[2].trim();
				cursor++;
				setScalarOrRecurse(inlineValue, indent, path);
			}
		}

		/** Handles "- value", "- key: value", and bare "-" (nested block on following lines). */
		function parseListItem(rest: string, dashIndent: number, path: string): void {
			if (rest === '') {
				const blockIndent = cursor < lines.length ? indentOf(lines[cursor]) : -1;
				if (blockIndent > dashIndent) {
					parseBlock(blockIndent, path);
				} else {
					entries.set(path, '');
				}
				return;
			}

			const inlineMatch = /^([^:]+):\s*(.*)$/.exec(rest);
			if (!inlineMatch) {
				entries.set(path, unquoteYamlScalar(rest));
				return;
			}

			// "- key: value": an object item. Its other keys are conventionally indented to
			// align under where "key" starts, i.e. 2 columns past the dash.
			const itemIndent = dashIndent + 2;
			const key = inlineMatch[1].trim().replace(/^["']|["']$/g, '');
			setScalarOrRecurse(inlineMatch[2].trim(), itemIndent, `${path}.${key}`);
			parseBlock(itemIndent, path); // consume this item's remaining sibling keys, if any
		}

		/** Shared by mapping values and "- key: value" items: inline scalar, or recurse into a nested block. */
		function setScalarOrRecurse(inlineValue: string, ownIndent: number, path: string): void {
			if (inlineValue !== '') {
				entries.set(path, unquoteYamlScalar(inlineValue));
				return;
			}

			const blockIndent = cursor < lines.length ? indentOf(lines[cursor]) : -1;
			if (blockIndent <= ownIndent) {
				entries.set(path, ''); // bare "key:" with no inline value or children
				return;
			}

			const blockStart = cursor;
			if (isStructuredLine(lines[blockStart].trim())) {
				parseBlock(blockIndent, path);
			} else {
				while (cursor < lines.length && indentOf(lines[cursor]) >= blockIndent) {
					cursor++;
				}
				entries.set(path, lines.slice(blockStart, cursor).join('\n'));
			}
		}

		parseBlock(0, '');
		return entries;
	}

	serialize(entries: ConfigEntries): string {
		return stringifyYaml(buildNestedModel(entries), 0);
	}
}

function unquoteYamlScalar(value: string): string {
	if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\'')))) {
		return value.slice(1, -1);
	}
	return value;
}

function stringifyYaml(node: unknown, depth: number): string {
	const indent = '  '.repeat(depth);

	if (Array.isArray(node)) {
		if (node.length === 0) {
			return `${indent}[]\n`;
		}
		const lines: string[] = [];
		for (const item of node) {
			if (item !== null && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length > 0) {
				// "- " + first key inline; remaining keys of this same item align 2 columns in.
				Object.entries(item as Record<string, unknown>).forEach(([key, value], i) => {
					const prefix = i === 0 ? `${indent}- ` : `${indent}  `;
					lines.push(...stringifyYamlEntry(key, value, prefix, depth + 2));
				});
			} else {
				lines.push(`${indent}- ${formatYamlScalar(item)}`);
			}
		}
		return lines.join('\n') + '\n';
	}

	const lines: string[] = [];
	for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
		lines.push(...stringifyYamlEntry(key, value, indent, depth + 1));
	}
	return lines.join('\n') + '\n';
}

/** Renders one "key: value" (or "key:" + nested block) line, reused for both plain mappings and list items. */
function stringifyYamlEntry(key: string, value: unknown, linePrefix: string, childDepth: number): string[] {
	if (value !== null && typeof value === 'object') {
		return [`${linePrefix}${key}:`, stringifyYaml(value, childDepth).replace(/\n$/, '')];
	}
	if (typeof value === 'string' && value.includes('\n')) {
		return [`${linePrefix}${key}:`, value]; // raw block captured by parse(), kept verbatim
	}
	return [`${linePrefix}${key}: ${formatYamlScalar(value)}`];
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
