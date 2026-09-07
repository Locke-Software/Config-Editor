import { ConfigEntries } from './ConfigFormatParser';

/**
 * Shared by any format whose native structure is nested objects/arrays (JSON, YAML): converts
 * between that nested shape and the flat dot-path ConfigEntries model used everywhere else.
 */

/** Flattens a nested value (objects/arrays/scalars) into dot-path entries, e.g. "servers.0.host". */
export function flattenModel(value: unknown, prefix: string, out: ConfigEntries): void {
	if (Array.isArray(value)) {
		// Array items are addressed by index (e.g. "servers.0.host"), which then
		// group into the tree UI as an "unnamed" section per item, same as objects.
		value.forEach((item, index) => flattenModel(item, prefix ? `${prefix}.${index}` : String(index), out));
		return;
	}
	if (value !== null && typeof value === 'object') {
		for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
			flattenModel(child, prefix ? `${prefix}.${key}` : key, out);
		}
		return;
	}
	out.set(prefix, value === undefined ? '' : String(value));
}

/** The reverse of flattenModel(): rebuilds a nested object/array tree from dot-path entries. */
export function buildNestedModel(entries: ConfigEntries): unknown {
	const root: Record<string, unknown> = {};
	for (const [dottedKey, value] of entries) {
		setDeep(root, dottedKey.split('.'), coerce(value));
	}
	return arrayify(root);
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

/**
 * setDeep() always builds plain objects (dot-path segments are just object keys), so any level
 * that's really an array - i.e. every key is exactly "0", "1", ..., "n-1" in order - is converted
 * back into a real array here, recursively.
 */
function arrayify(node: unknown): unknown {
	if (node === null || typeof node !== 'object' || Array.isArray(node)) {
		return node;
	}
	const obj = node as Record<string, unknown>;
	const keys = Object.keys(obj);
	const isArrayLike = keys.length > 0 && keys.every((key, index) => key === String(index));
	if (isArrayLike) {
		return keys.map(key => arrayify(obj[key]));
	}
	const result: Record<string, unknown> = {};
	for (const key of keys) {
		result[key] = arrayify(obj[key]);
	}
	return result;
}

/** Converts an edited string value back to a JSON/YAML-friendly primitive when possible. */
function coerce(value: string): unknown {
	if (value === 'true') { return true; }
	if (value === 'false') { return false; }
	if (value !== '' && !Number.isNaN(Number(value))) { return Number(value); }
	return value;
}
