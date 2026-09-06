// @ts-nocheck
(function () {
	const vscode = acquireVsCodeApi();
	const container = document.getElementById('table-container');
	const saveAllButton = document.getElementById('save-all');
	const addFileButton = document.getElementById('add-file');

	/** @type {{ files: {uri:string,name:string,dirty:boolean}[], rows: {key:string, values: Record<string,string>}[] }} */
	let state = { files: [], rows: [] };

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

	function render() {
		const anyDirty = state.files.some(f => f.dirty);
		saveAllButton.disabled = !anyDirty;

		if (state.files.length === 0) {
			container.innerHTML = '<p class="empty">No environment files open yet. Click "+ Add Environment" to get started.</p>';
			return;
		}

		const table = document.createElement('table');
		table.appendChild(buildHeader());
		table.appendChild(buildBody());
		container.innerHTML = '';
		container.appendChild(table);
		container.appendChild(buildAddRowForm());
	}

	function buildHeader() {
		const thead = document.createElement('thead');
		const tr = document.createElement('tr');

		const keyTh = document.createElement('th');
		keyTh.className = 'key-column';
		keyTh.textContent = 'Config Item';
		tr.appendChild(keyTh);

		for (const file of state.files) {
			const th = document.createElement('th');
			th.dataset.uri = file.uri;

			const title = document.createElement('span');
			title.className = 'file-name';
			title.textContent = file.name;
			title.title = file.uri;
			th.appendChild(title);

			const dirtyDot = document.createElement('span');
			dirtyDot.className = 'dirty-dot';
			dirtyDot.textContent = ' \u25CF';
			dirtyDot.style.visibility = file.dirty ? 'visible' : 'hidden';
			th.appendChild(dirtyDot);

			const actions = document.createElement('div');
			actions.className = 'header-actions';

			const saveBtn = document.createElement('button');
			saveBtn.textContent = 'Save';
			saveBtn.disabled = !file.dirty;
			saveBtn.addEventListener('click', () => vscode.postMessage({ type: 'save', uri: file.uri }));
			actions.appendChild(saveBtn);

			const removeBtn = document.createElement('button');
			removeBtn.textContent = 'Remove';
			removeBtn.className = 'secondary';
			removeBtn.addEventListener('click', () => vscode.postMessage({ type: 'removeFile', uri: file.uri }));
			actions.appendChild(removeBtn);

			th.appendChild(actions);
			tr.appendChild(th);
		}

		thead.appendChild(tr);
		return thead;
	}

	function buildBody() {
		const tbody = document.createElement('tbody');
		for (const row of state.rows) {
			const tr = document.createElement('tr');

			const keyTd = document.createElement('td');
			keyTd.className = 'key-column';
			const keyLabel = document.createElement('span');
			keyLabel.textContent = row.key;
			keyTd.appendChild(keyLabel);
			const removeRowBtn = document.createElement('button');
			removeRowBtn.className = 'remove-row secondary';
			removeRowBtn.textContent = '\u2715';
			removeRowBtn.title = 'Remove this config item';
			removeRowBtn.addEventListener('click', () => vscode.postMessage({ type: 'removeKey', key: row.key }));
			keyTd.appendChild(removeRowBtn);
			tr.appendChild(keyTd);

			for (const file of state.files) {
				const td = document.createElement('td');
				const input = document.createElement('input');
				input.type = 'text';
				input.value = row.values[file.uri] ?? '';
				input.dataset.uri = file.uri;
				input.dataset.key = row.key;
				input.addEventListener('change', () => {
					vscode.postMessage({ type: 'edit', uri: file.uri, key: row.key, value: input.value });
				});
				td.appendChild(input);
				tr.appendChild(td);
			}

			tbody.appendChild(tr);
		}
		return tbody;
	}

	function buildAddRowForm() {
		const form = document.createElement('form');
		form.id = 'add-row-form';

		const input = document.createElement('input');
		input.type = 'text';
		input.placeholder = 'New config item name';
		form.appendChild(input);

		const button = document.createElement('button');
		button.type = 'submit';
		button.textContent = '+ Add Item';
		form.appendChild(button);

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
			const saveBtn = th.querySelector('.header-actions button');
			if (saveBtn) { saveBtn.disabled = !dirty; }
		}
		saveAllButton.disabled = !state.files.some(f => f.dirty);
	}

	function cssEscape(value) {
		return window.CSS && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
	}

	vscode.postMessage({ type: 'ready' });
}());
