// @ts-nocheck
(function () {
	const vscode = acquireVsCodeApi();
	const container = document.getElementById('table-container');
	const saveAllButton = document.getElementById('save-all');
	const addFileButton = document.getElementById('add-file');
	const reloadButton = document.getElementById('reload');
	const settingsToggle = document.getElementById('settings-toggle');
	const settingsMenu = document.getElementById('settings-menu');

	/** @type {{ files: {uri:string,name:string,dirty:boolean}[], tree: {path:string,name:string,children:any[],values?:Record<string,string>}[] }} */
	let state = { files: [], tree: [] };

	const persisted = vscode.getState() ?? {};
	const collapsedPaths = new Set(persisted.collapsed ?? []);
	const defaultSettings = { rowStripes: false, colStripes: false, rowHover: false, colHover: false };
	const settings = { ...defaultSettings, ...(persisted.settings ?? {}) };

	// Column widths, keyed by file uri ('__key__' for the label column), persisted across reloads.
	const KEY_COLUMN_KEY = '__key__';
	const KEY_COLUMN_DEFAULT_WIDTH = 200;
	const FILE_COLUMN_DEFAULT_WIDTH = 220;
	const MIN_COLUMN_WIDTH = 80;
	const columnWidths = { ...(persisted.columnWidths ?? {}) };

	function persist() {
		vscode.setState({ collapsed: [...collapsedPaths], settings, columnWidths });
	}

	window.addEventListener('message', event => {
		const message = event.data;
		switch (message.type) {
			case 'init':
				state = message.state;
				render();
				break;
			case 'setDirty':
				setDirty(message.uri, message.dirty);
				break;
			case 'setUnsaved':
				setUnsaved(message.uri, message.key, message.unsaved);
				break;
		}
	});

	saveAllButton.addEventListener('click', () => vscode.postMessage({ type: 'saveAll' }));
	addFileButton.addEventListener('click', () => vscode.postMessage({ type: 'addFile' }));
	reloadButton.addEventListener('click', () => vscode.postMessage({ type: 'reload' }));

	// Display settings popover: toggle open/closed, close on outside click, and
	// apply/persist each checkbox's value as it changes.
	settingsToggle.addEventListener('click', event => {
		event.stopPropagation();
		settingsMenu.hidden = !settingsMenu.hidden;
	});

	document.addEventListener('click', event => {
		if (!settingsMenu.hidden && !event.target.closest('.settings')) {
			settingsMenu.hidden = true;
		}
	});

	const settingInputs = {
		rowStripes: document.getElementById('setting-row-stripes'),
		colStripes: document.getElementById('setting-col-stripes'),
		rowHover: document.getElementById('setting-row-hover'),
		colHover: document.getElementById('setting-col-hover')
	};

	for (const [key, input] of Object.entries(settingInputs)) {
		input.checked = settings[key];
		input.addEventListener('change', () => {
			settings[key] = input.checked;
			applySettingsToDom();
			persist();
		});
	}

	function applySettingsToDom() {
		document.body.classList.toggle('settings-row-stripes', settings.rowStripes);
		document.body.classList.toggle('settings-col-stripes', settings.colStripes);
		document.body.classList.toggle('settings-row-hover', settings.rowHover);
		if (!settings.colHover) {
			hoveredColumn = -1;
			clearColumnHighlight();
		}
	}

	// Custom right-click context menu (a plain browser context menu can't have
	// custom items). Callers pass a list of {label, onSelect} entries.
	let contextMenuEl = null;

	function showContextMenu(x, y, items) {
		hideContextMenu();
		const menu = document.createElement('div');
		menu.className = 'context-menu';
		menu.style.left = `${x}px`;
		menu.style.top = `${y}px`;
		for (const item of items) {
			const button = document.createElement('button');
			button.textContent = item.label;
			button.addEventListener('click', () => {
				hideContextMenu();
				item.onSelect();
			});
			menu.appendChild(button);
		}
		document.body.appendChild(menu);
		contextMenuEl = menu;
	}

	function hideContextMenu() {
		contextMenuEl?.remove();
		contextMenuEl = null;
	}

	document.addEventListener('click', hideContextMenu);
	window.addEventListener('blur', hideContextMenu);

	// Column hover highlight: track which column index is under the pointer and
	// tag every (non-spanning) cell that shares it, since CSS alone can't select
	// "all cells in this column" across rows.
	let hoveredColumn = -1;

	container.addEventListener('mouseover', event => {
		if (!settings.colHover) {
			return;
		}
		const cell = event.target.closest('td, th');
		if (!cell || cell.colSpan > 1 || cell.cellIndex === hoveredColumn) {
			return;
		}
		hoveredColumn = cell.cellIndex;
		applyColumnHighlight(hoveredColumn);
	});

	container.addEventListener('mouseleave', () => {
		hoveredColumn = -1;
		clearColumnHighlight();
	});

	function applyColumnHighlight(index) {
		clearColumnHighlight();
		const table = container.querySelector('table');
		if (!table) {
			return;
		}
		for (const row of table.rows) {
			const cell = row.cells[index];
			if (cell && cell.colSpan <= 1) {
				cell.classList.add('col-hover');
			}
		}
	}

	function clearColumnHighlight() {
		container.querySelectorAll('.col-hover').forEach(el => el.classList.remove('col-hover'));
	}

	applySettingsToDom();

	/** Clones a <template id="..."> from main.html; its markup drives the table's structure. */
	function cloneTemplate(id) {
		return document.getElementById(id).content.cloneNode(true);
	}

	function render() {
		const anyDirty = state.files.some(f => f.dirty);
		saveAllButton.disabled = !anyDirty;

		container.innerHTML = '';

		if (state.files.length === 0) {
			container.appendChild(cloneTemplate('tpl-empty-state'));
			return;
		}

		const table = document.createElement('table');
		table.appendChild(buildColGroup());
		table.appendChild(buildHeader());
		table.appendChild(buildBody());

		const wrapper = document.createElement('div');
		wrapper.className = 'table-wrapper';
		wrapper.appendChild(table);

		const rulerHost = document.createElement('div');
		rulerHost.className = 'scroll-ruler-host';
		rulerHost.appendChild(wrapper);
		const ruler = document.createElement('div');
		ruler.className = 'scroll-ruler';
		rulerHost.appendChild(ruler);

		container.appendChild(rulerHost);
		container.appendChild(buildAddRowForm());

		updateScrollRuler();
	}

	/**
	 * Mirrors VS Code's editor overview ruler: one small tick per flagged row,
	 * positioned proportionally to that row's place in the full (not just
	 * visible) table height, so it maps onto the scrollbar's whole range.
	 */
	function updateScrollRuler() {
		const wrapper = container.querySelector('.table-wrapper');
		const ruler = container.querySelector('.scroll-ruler');
		const table = wrapper?.querySelector('table');
		if (!wrapper || !ruler || !table) {
			return;
		}

		ruler.innerHTML = '';
		const totalHeight = table.offsetHeight;
		if (totalHeight === 0) {
			return;
		}

		for (const row of table.querySelectorAll('tbody tr')) {
			const severity = rowSeverity(row);
			if (!severity) {
				continue;
			}
			const tick = document.createElement('div');
			tick.className = `ruler-tick ruler-tick-${severity}`;
			tick.style.top = `${(row.offsetTop / totalHeight) * 100}%`;
			tick.title = RULER_SEVERITY_LABELS[severity];
			tick.addEventListener('click', () => {
				wrapper.scrollTop = row.offsetTop - (wrapper.clientHeight - row.offsetHeight) / 2;
			});
			ruler.appendChild(tick);
		}
	}

	const RULER_SEVERITY_LABELS = {
		error: 'Missing and in a different position in this row',
		warning: 'Missing from a file in this row',
		info: 'In a different position in this row',
		unsaved: 'Unsaved changes in this row',
		uncommitted: 'Uncommitted changes in this row'
	};

	/** Worst-to-least-severe: a row only gets one tick even if multiple cells/issues apply. */
	function rowSeverity(row) {
		if (row.querySelector('.cell-missing.cell-misplaced')) { return 'error'; }
		if (row.querySelector('.cell-missing')) { return 'warning'; }
		if (row.querySelector('.cell-misplaced')) { return 'info'; }
		if (row.querySelector('.cell-unsaved')) { return 'unsaved'; }
		if (row.querySelector('.cell-uncommitted')) { return 'uncommitted'; }
		return null;
	}

	function buildColGroup() {
		const colgroup = document.createElement('colgroup');
		colgroup.appendChild(buildCol(KEY_COLUMN_KEY, KEY_COLUMN_DEFAULT_WIDTH));
		for (const file of state.files) {
			colgroup.appendChild(buildCol(file.uri, FILE_COLUMN_DEFAULT_WIDTH));
		}
		return colgroup;
	}

	function buildCol(columnKey, defaultWidth) {
		const col = document.createElement('col');
		col.dataset.columnKey = columnKey;
		col.style.width = `${columnWidths[columnKey] ?? defaultWidth}px`;
		return col;
	}

	function getColElement(columnKey) {
		const table = container.querySelector('table');
		return table?.querySelector(`col[data-column-key="${cssEscape(columnKey)}"]`) ?? null;
	}

	/** Adds a draggable resize handle to a header cell's right edge; columnKey matches a <col>'s dataset.columnKey. */
	function addResizeHandle(th, columnKey) {
		const handle = document.createElement('div');
		handle.className = 'col-resize-handle';
		th.appendChild(handle);

		handle.addEventListener('mousedown', event => {
			event.preventDefault();
			event.stopPropagation();

			const startX = event.clientX;
			const startWidth = columnWidths[columnKey] ?? th.getBoundingClientRect().width;
			const col = getColElement(columnKey);
			document.body.classList.add('resizing-column');

			const onMouseMove = moveEvent => {
				const width = Math.max(MIN_COLUMN_WIDTH, startWidth + (moveEvent.clientX - startX));
				columnWidths[columnKey] = width;
				if (col) {
					col.style.width = `${width}px`;
				}
			};
			const onMouseUp = () => {
				document.removeEventListener('mousemove', onMouseMove);
				document.removeEventListener('mouseup', onMouseUp);
				document.body.classList.remove('resizing-column');
				persist();
			};
			document.addEventListener('mousemove', onMouseMove);
			document.addEventListener('mouseup', onMouseUp);
		});
	}

	function buildHeader() {
		const thead = document.createElement('thead');
		const tr = document.createElement('tr');

		const keyTh = cloneTemplate('tpl-key-header').firstElementChild;
		addResizeHandle(keyTh, KEY_COLUMN_KEY);
		tr.appendChild(keyTh);

		for (const file of state.files) {
			const th = cloneTemplate('tpl-file-header').firstElementChild;
			th.dataset.uri = file.uri;

			const name = th.querySelector('.file-name');
			name.textContent = file.name;
			name.title = file.uri;

			th.querySelector('.dirty-dot').style.visibility = file.dirty ? 'visible' : 'hidden';

			const saveBtn = th.querySelector('.save-btn');
			saveBtn.disabled = !file.dirty;
			saveBtn.addEventListener('click', () => vscode.postMessage({ type: 'save', uri: file.uri }));

			th.querySelector('.remove-btn').addEventListener('click', () => vscode.postMessage({ type: 'removeFile', uri: file.uri }));

			th.addEventListener('contextmenu', event => {
				event.preventDefault();
				showContextMenu(event.pageX, event.pageY, [
					{ label: 'Open File', onSelect: () => vscode.postMessage({ type: 'openFile', uri: file.uri }) }
				]);
			});

			addResizeHandle(th, file.uri);
			tr.appendChild(th);
		}

		thead.appendChild(tr);
		return thead;
	}

	function buildBody() {
		const tbody = document.createElement('tbody');
		appendNodes(tbody, state.tree, 0);
		return tbody;
	}

	/** Recursively renders a node: a section row (with nested children) or a leaf row (with editable cells). */
	function appendNodes(tbody, nodes, depth) {
		for (const node of nodes) {
			if (node.children.length > 0) {
				tbody.appendChild(buildSectionRow(node, depth));
				if (!collapsedPaths.has(node.path)) {
					appendNodes(tbody, node.children, depth + 1);
				}
			} else {
				tbody.appendChild(buildLeafRow(node, depth));
			}
		}
	}

	function buildSectionRow(node, depth) {
		const tr = cloneTemplate('tpl-section-row').firstElementChild;
		const td = tr.querySelector('td');
		td.style.paddingLeft = `${8 + depth * 20}px`;

		const collapsed = collapsedPaths.has(node.path);
		td.querySelector('.toggle').textContent = collapsed ? '\u25B6' : '\u25BC';
		td.querySelector('.section-name').textContent = node.name;

		// Whole-section reorder: same dot/tooltip styling as a misplaced field, just
		// scoped to the label cell since a section row has no per-file values.
		td.classList.remove('cell-misplaced');
		td.title = '';
		if (node.misplacedIn?.length > 0) {
			td.classList.add('cell-misplaced');
			const names = node.misplacedIn.map(uri => state.files.find(f => f.uri === uri)?.name ?? uri);
			td.title = `This section is in a different position in: ${names.join(', ')}`;
		}

		// One filler cell per file column instead of a single colspan cell -
		// colspan cells don't reliably support position: sticky in Chromium,
		// which broke the sticky key column specifically for section rows.
		for (let i = 0; i < state.files.length; i++) {
			tr.appendChild(cloneTemplate('tpl-section-filler').firstElementChild);
		}

		tr.addEventListener('click', () => toggleCollapse(node.path));

		return tr;
	}

	function buildLeafRow(node, depth) {
		const tr = cloneTemplate('tpl-leaf-row').firstElementChild;
		const keyTd = tr.querySelector('td');
		keyTd.style.paddingLeft = `${8 + depth * 20}px`;
		keyTd.querySelector('.key-name').textContent = node.name;

		for (const file of state.files) {
			const td = cloneTemplate('tpl-leaf-cell').firstElementChild;
			const input = td.querySelector('input');
			input.value = node.values[file.uri] ?? '';
			input.dataset.uri = file.uri;
			input.dataset.key = node.path;
			input.addEventListener('change', () => {
				vscode.postMessage({ type: 'edit', uri: file.uri, key: node.path, value: input.value });
			});
			td.addEventListener('contextmenu', event => {
				event.preventDefault();
				showContextMenu(event.pageX, event.pageY, [
					{ label: 'Go to Entry', onSelect: () => vscode.postMessage({ type: 'goToEntry', uri: file.uri, key: node.path }) }
				]);
			});
			applyCellAnnotations(td, node, file.uri);
			tr.appendChild(td);
		}

		return tr;
	}

	/** Flags a cell with validation warnings and/or change-tracking stripes, plus a combined tooltip.
	 *  Safe to call more than once on the same cell (e.g. from setUnsaved) since it clears first. */
	function applyCellAnnotations(td, node, uri) {
		td.classList.remove('cell-missing', 'cell-misplaced', 'cell-unsaved', 'cell-uncommitted');
		const messages = [];

		if (node.missingIn?.includes(uri)) {
			td.classList.add('cell-missing');
			messages.push('Missing from this file');
		}
		if (node.misplacedIn?.includes(uri)) {
			td.classList.add('cell-misplaced');
			messages.push('Appears in a different position here than in the other open files');
		}

		// Unsaved (grey) takes priority over uncommitted (blue): once saved, a field
		// either stops changing or moves from "unsaved" to "uncommitted".
		if (node.unsavedIn?.includes(uri)) {
			td.classList.add('cell-unsaved');
			messages.push('Edited but not saved to disk');
		} else if (node.uncommittedIn?.includes(uri)) {
			td.classList.add('cell-uncommitted');
			messages.push('Saved but not committed to version control');
		}

		td.title = messages.join(' \u2014 ');
	}

	/** Depth-first search for the leaf/section node with this exact path. */
	function findNode(nodes, targetPath) {
		for (const node of nodes) {
			if (node.path === targetPath) {
				return node;
			}
			if (node.children.length > 0) {
				const found = findNode(node.children, targetPath);
				if (found) {
					return found;
				}
			}
		}
		return null;
	}

	/** Updates one cell's grey "unsaved" indicator in place, without a full re-render (would steal focus mid-typing). */
	function setUnsaved(uri, key, unsaved) {
		const node = findNode(state.tree, key);
		if (!node) {
			return;
		}
		node.unsavedIn = node.unsavedIn ?? [];
		const index = node.unsavedIn.indexOf(uri);
		if (unsaved && index === -1) {
			node.unsavedIn.push(uri);
		} else if (!unsaved && index !== -1) {
			node.unsavedIn.splice(index, 1);
		}

		const input = container.querySelector(`input[data-uri="${cssEscape(uri)}"][data-key="${cssEscape(key)}"]`);
		const td = input?.closest('td');
		if (td) {
			applyCellAnnotations(td, node, uri);
			updateScrollRuler();
		}
	}

	function toggleCollapse(path) {
		if (collapsedPaths.has(path)) {
			collapsedPaths.delete(path);
		} else {
			collapsedPaths.add(path);
		}
		vscode.setState({ collapsed: [...collapsedPaths], settings });
		render();
	}

	function buildAddRowForm() {
		const form = cloneTemplate('tpl-add-row-form').firstElementChild;
		const input = form.querySelector('input');

		form.addEventListener('submit', event => {
			event.preventDefault();
			if (input.value.trim()) {
				vscode.postMessage({ type: 'addKey', key: input.value.trim() });
				input.value = '';
			}
		});

		return form;
	}

	function setDirty(uri, dirty) {
		const file = state.files.find(f => f.uri === uri);
		if (file) {
			file.dirty = dirty;
		}
		const th = container.querySelector(`th[data-uri="${cssEscape(uri)}"]`);
		if (th) {
			const dot = th.querySelector('.dirty-dot');
			if (dot) { dot.style.visibility = dirty ? 'visible' : 'hidden'; }
			const saveBtn = th.querySelector('.save-btn');
			if (saveBtn) { saveBtn.disabled = !dirty; }
		}
		saveAllButton.disabled = !state.files.some(f => f.dirty);
	}

	function cssEscape(value) {
		return window.CSS && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
	}

	vscode.postMessage({ type: 'ready' });
}());
