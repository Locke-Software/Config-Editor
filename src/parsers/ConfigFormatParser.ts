import * as vscode from 'vscode';

/** Supported on-disk config file formats, one parser class per format (see getConfigParser()). */
export type ConfigFormat = 'json' | 'yaml' | 'ini' | 'properties';

/**
 * Ordered key/value pairs - the normalized, format-agnostic model every parser produces and
 * consumes, and what the rest of the extension (tree building, validation, editing) works
 * against regardless of source format. A plain Map is used (instead of a plain object) so
 * insertion order - and therefore the row order shown in the table - is preserved. Nested
 * config structure (JSON/YAML objects, arrays, INI sections) is represented with dot-separated
 * keys (e.g. "database.pool.min", "servers.0.host"), which is also exactly what the table UI
 * groups into recursive sections.
 */
export type ConfigEntries = Map<string, string>;

/** Parses/serializes one config file format to and from the normalized ConfigEntries model. */
export interface ConfigFormatParser {
	parse(text: string): ConfigEntries;
	serialize(entries: ConfigEntries): string;
}

/** Picks a format (and therefore parser) based on the file extension. */
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
