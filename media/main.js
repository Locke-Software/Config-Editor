// @ts-nocheck
(function () {
	const vscode = acquireVsCodeApi();
	const container = document.getElementById('table-container');
	const saveAllButton = document.getElementById('save-all');
	const addFileButton = document.getElementById('add-file');

	/** @type {{ files: {uri:string,name:string,dirty:boolean}[], tree: {path:string,name:string,children:any[],values?:Record<string,string>}[] }} */
	let state = { files: [], tree: [] };
	const collapsedPaths = new Set(vscode.getState()?.collapsed ?? []);

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
		container.appendChild(table);
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
		td.querySelector('.remove-row').addEventListener('click', event => {
			event.stopPropagation();
			vscode.postMessage({ type: 'removeSection', path: node.path });
		});

		return tr;
	}

	function buildLeafRow(node, depth) {
		const tr = cloneTemplate('tpl-leaf-row').firstElementChild;
		const keyTd = tr.querySelector('td');
		keyTd.style.paddingLeft = `${8 + depth * 20}px`;
		keyTd.querySelector('.key-name').textContent = node.name;
		keyTd.querySelector('.remove-row').addEventListener('click', () => vscode.postMessage({ type: 'removeKey', key: node.path }));

		for (const file of state.files) {
			const td = cloneTemplate('tpl-leaf-cell').firstElementChild;
			const input = td.querySelector('input');
			input.value = node.values[file.uri] ?? '';
			input.dataset.uri = file.uri;
			input.dataset.key = node.path;
			input.addEventListener('change', () => {
				vscode.postMessage({ type: 'edit', uri: file.uri, key: node.path, value: input.value });
			});
			tr.appendChild(td);
		}

		return tr;
	}

	function toggleCollapse(path) {
		if (collapsedPaths.has(path)) {
			collapsedPaths.delete(path);
		} else {
			collapsedPaths.add(path);
		}
		vscode.setState({ collapsed: [...collapsedPaths] });
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
