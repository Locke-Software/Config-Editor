/** Finds the "key=value"/"key: value" separator, preferring whichever comes first. Shared by the
 *  properties and INI parsers, which both use this same "key <sep> value" line syntax. */
export function findSeparator(line: string): number {
	const eq = line.indexOf('=');
	const colon = line.indexOf(':');
	if (eq === -1) { return colon; }
	if (colon === -1) { return eq; }
	return Math.min(eq, colon);
}
