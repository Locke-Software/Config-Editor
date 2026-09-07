# ConfigEditor

Edit multiple environment config files (e.g. `dev`, `staging`, `prod`) side-by-side in a single table view, instead of flipping between tabs to compare and edit them one at a time.

## Features

- **Multi-file table view**: rows are config keys, columns are your files/environments (`.json`, `.yaml`, `.ini`, `.env`/`.properties`). Nested/dotted keys (e.g. `database.pool.min`) and array items (e.g. `servers.0.host`) render as collapsible sections, including "unnamed" object list entries.
- **Edit in place**: change any cell and save one file or all open files at once.
- **Add/remove keys, sections, and files** directly from the table.
- **Validation at a glance**: cells are flagged when a key is missing from a file, or when a key/section sits in a different order than the others, so drift between environments is easy to spot.
- **Change tracking**: cells show a stripe for unsaved edits, and a separate stripe for changes saved to disk but not yet committed (via the built-in Git extension), similar to the editor's gutter indicators.
- **Reload from disk** to pick up external edits or Git changes without closing the panel.
- **Right-click a file header or cell** to open the underlying file or jump straight to that entry's line.
- **Resizable columns** and a **sticky header/label column** for scanning wide tables.
- **Scrollbar overview ruler**: ticks next to the scrollbar mark rows with validation or change-tracking issues, similar to the editor's error/warning markers.
- **Display settings** (row/column stripes, row/column hover highlighting) to make wide tables easier to scan.

## Usage

Right-click one or more config files in the Explorer and choose **Open in Config Editor**, or run the same command from the Command Palette to pick files via a dialog.

## Supported formats

`.json`, `.yaml`/`.yml`, `.ini`, and `.env`/`.properties`-style key=value files. JSON and YAML arrays (including arrays of objects) are supported: items are addressed by index and rendered as their own section.

## Known Issues

- YAML flow-style syntax (`[a, b]`, `{a: 1}`) and block scalars (`|`, `>`) are preserved as opaque text rather than edited structurally.
- "Go to entry" line lookup for JSON/YAML is an approximation based on the last key segment, since flattened dot-paths have no exact 1:1 line mapping.

## Release Notes

### 0.0.4

- Support arrays and "unnamed" object list entries in JSON/YAML (e.g. `servers.0.host`).
- Resizable columns, sticky header/label column, and a scrollbar overview ruler for validation/change ticks.
- Internal: parsers reorganized into one class per format (no functional change).

### 0.0.1

Initial release.

**Enjoy!**
