# Change Log

All notable changes to the "configeditor" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### 0.0.4

- Support arrays and "unnamed" object list entries in JSON/YAML (e.g. `servers.0.host`), instead of treating them as opaque text.
- Resizable table columns.
- Sticky header row and label column while scrolling.
- Scrollbar overview ruler: ticks mark rows with validation or change-tracking issues.
- Internal: parsers reorganized into one class per format under `src/parsers/` (no functional change).

## [0.0.3]

- INI and YAML format support (INI sections, YAML nested mappings).
- Nested-section (2+ levels deep) support and test fixtures.
- Table layout fixes (sticky header/body scrolling, borders).

## [0.0.2]

- Publisher metadata and MIT license for Marketplace publishing.
- Marketplace categories and keywords.
- README updates.

## [0.0.1]

- Initial release