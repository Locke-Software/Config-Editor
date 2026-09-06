// @ts-nocheck
(function () {
	const vscode = acquireVsCodeApi();
	const container = document.getElementById('table-container');
	const saveAllButton = document.getElementById('save-all');
	const addFileButton = document.getElementById('add-file');
	const settingsToggle = document.getElementById('settings-toggle');
	const settingsMenu = document.getElementById('settings-menu');

	/** @type {{ files: {uri:string,name:string,dirty:boolean}[], tree: {path:string,name:string,children:any[],values?:Record<string,string>}[] }} */
	let state = { files: [], tree: [] };

	const persisted = vscode.getState() ?? {};
	const collapsedPaths = new Set(persisted.collapsed ?? []);
	const defaultSettings = { rowStripes: true, colStripes: false, rowHover: false, colHover: true };
	const settings = { ...defaultSettings, ...(persisted.settings ?? {}) };

	function persist() {
		vscode.setState({ collapsed: [...collapsedPaths], settings });
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
		}
	});

	saveAllButton.addEventListener('click', () => vscode.postMessage({ type: 'saveAll' }));
	addFileButton.addEventListener('click', () => vscode.postMessage({ type: 'addFile' }));

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
		table.appendChild(buildHeader());
		table.appendChild(buildBody());

		const wrapper = document.createElement('div');
		wrapper.className = 'table-wrapper';
		wrapper.appendChild(table);

		container.appendChild(wrapper);
		container.appendChild(buildAddRowForm());
	}

	function buildHeader() {
		const thead = document.createElement('thead');
		const tr = document.createElement('tr');

		tr.appendChild(cloneTemplate('tpl-key-header').firstElementChild);

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
		td.colSpan = 1 + state.files.length;
		td.style.paddingLeft = `${8 + depth * 20}px`;

		const collapsed = collapsedPaths.has(node.path);
		td.querySelector('.toggle').textContent = collapsed ? '\u25B6' : '\u25BC';
		td.querySelector('.section-name').textContent = node.name;

		td.addEventListener('click', () => toggleCollapse(node.path));

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
			applyValidation(td, node, file.uri);
			tr.appendChild(td);
		}

		return tr;
	}

	/** Flags a cell with a warning-colored inner border + tooltip when the extension reports an issue. */
	function applyValidation(td, node, uri) {
		const issues = [];
		if (node.missingIn?.includes(uri)) {
			td.classList.add('cell-missing');
			issues.push('Missing from this file');
		}
		if (node.misplacedIn?.includes(uri)) {
			td.classList.add('cell-misplaced');
			issues.push('Appears in a different position here than in the other open files');
		}
		if (issues.length > 0) {
			td.title = issues.join(' \u2014 ');
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
