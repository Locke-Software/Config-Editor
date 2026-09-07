import { ConfigEntries, ConfigFormatParser } from './ConfigFormatParser';
import { findSeparator } from './kvLineUtils';

/**
 * properties / .env style: one "key=value" (or "key: value") per line, no sections. Blank
 * lines and lines starting with # or ; are comments.
 */
export class PropertiesConfigParser implements ConfigFormatParser {
	parse(text: string): ConfigEntries {
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

	serialize(entries: ConfigEntries): string {
		const lines: string[] = [];
		for (const [key, value] of entries) {
			lines.push(`${key}=${value}`);
		}
		return lines.join('\n') + '\n';
	}
}
