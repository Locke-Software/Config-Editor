import { ConfigEntries, ConfigFormatParser } from './ConfigFormatParser';
import { findSeparator } from './kvLineUtils';

/**
 * INI: "[section]" headers group the "key=value" lines under them into "section.key" entries,
 * which maps directly onto our section/tree UI. Keys that appear before any section header
 * stay top-level (no prefix).
 */
export class IniConfigParser implements ConfigFormatParser {
	parse(text: string): ConfigEntries {
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

	serialize(entries: ConfigEntries): string {
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
}
