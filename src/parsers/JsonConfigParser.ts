import { ConfigEntries, ConfigFormatParser } from './ConfigFormatParser';
import { buildNestedModel, flattenModel } from './nestedModel';

/**
 * JSON: nested objects/arrays are flattened to dot-separated keys (e.g. "db.host",
 * "servers.0.host") so every leaf value gets its own row in the table.
 */
export class JsonConfigParser implements ConfigFormatParser {
	parse(text: string): ConfigEntries {
		const entries: ConfigEntries = new Map();
		if (!text.trim()) {
			return entries;
		}
		flattenModel(JSON.parse(text), '', entries);
		return entries;
	}

	serialize(entries: ConfigEntries): string {
		return JSON.stringify(buildNestedModel(entries), null, 2) + '\n';
	}
}
