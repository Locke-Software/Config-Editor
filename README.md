# ConfigEditor

Edit multiple environment config files (e.g. `dev`, `staging`, `prod`) side-by-side in a single table view, instead of flipping between tabs to compare and edit them one at a time.

## Features

- **Multi-file table view**: rows are config keys, columns are your files/environments (`.json`, `.yaml`, `.ini`, `.env`/`.properties`). Nested/dotted keys (e.g. `database.pool.min`) render as collapsible sections.
- **Edit in place**: change any cell and save one file or all open files at once.
- **Add/remove keys, sections, and files** directly from the table.
- **Validation at a glance**: cells are flagged when a key is missing from a file, or when a key/section sits in a different order than the others, so drift between environments is easy to spot.
- **Change tracking**: cells show a stripe for unsaved edits, and a separate stripe for changes saved to disk but not yet committed (via the built-in Git extension), similar to the editor's gutter indicators.
- **Reload from disk** to pick up external edits or Git changes without closing the panel.
- **Right-click a file header or cell** to open the underlying file or jump straight to that entry's line.
- **Display settings** (row/column stripes, row/column hover highlighting) to make wide tables easier to scan.

## Usage

Right-click one or more config files in the Explorer and choose **Open in Config Editor**, or run the same command from the Command Palette to pick files via a dialog.

## Supported formats

`.json`, `.yaml`/`.yml`, `.ini`, and `.env`/`.properties`-style key=value files.

## Known Issues

- YAML list values and other non-mapping blocks are preserved as opaque text rather than edited structurally.
- "Go to entry" line lookup for JSON is an approximation based on the last key segment, since flattened dot-paths have no exact 1:1 line mapping.

## Release Notes

### 0.0.1

Initial release.

**Enjoy!**
