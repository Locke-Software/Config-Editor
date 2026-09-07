import { ConfigFormat, ConfigFormatParser } from './ConfigFormatParser';
import { JsonConfigParser } from './JsonConfigParser';
import { YamlConfigParser } from './YamlConfigParser';
import { IniConfigParser } from './IniConfigParser';
import { PropertiesConfigParser } from './PropertiesConfigParser';

export type { ConfigFormat, ConfigEntries, ConfigFormatParser } from './ConfigFormatParser';
export { detectFormat } from './ConfigFormatParser';

const parsers: Record<ConfigFormat, ConfigFormatParser> = {
	json: new JsonConfigParser(),
	yaml: new YamlConfigParser(),
	ini: new IniConfigParser(),
	properties: new PropertiesConfigParser()
};

/** Returns the parser instance for a config format - one class per format, sharing a common interface. */
export function getConfigParser(format: ConfigFormat): ConfigFormatParser {
	return parsers[format];
}
