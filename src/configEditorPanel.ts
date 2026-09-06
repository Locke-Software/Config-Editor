import * as vscode from 'vscode';
import * as path from 'path';
import { ConfigEntries, ConfigFormat, detectFormat, parseConfig, serializeConfig } from './configParser';

interface FileState {
	uri: vscode.Uri;
	format: ConfigFormat;
	entries: ConfigEntries;
	dirty: boolean;
}

const OPEN_DIALOG_FILTERS: Record<string, string[]> = {
	'Config files': ['json', 'env', 'ini', 'properties', 'cfg', 'conf', 'yaml', 'yml', 'txt'],
	'All files': ['*']
};

/** Manages a single "Config Editor" webview tab that shows N config files as a key/value table. */
export class ConfigEditorPanel {
	private static readonly panels = new Set<ConfigEditorPanel>();
	public static readonly viewType = 'configEditor.tableView';

	private readonly panel: vscode.WebviewPanel;
	private readonly extensionUri: vscode.Uri;
	private readonly disposables: vscode.Disposable[] = [];

	private files: FileState[] = [];
	private keyOrder: string[] = [];

	public static async createOrShow(extensionUri: vscode.Uri, uris: vscode.Uri[]): Promise<void> {
		const panel = vscode.window.createWebviewPanel(
			ConfigEditorPanel.viewType,
			'Config Editor',
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
				retainContextWhenHidden: true
			}
		);
		const instance = new ConfigEditorPanel(panel, extensionUri);
		ConfigEditorPanel.panels.add(instance);
		await instance.addFiles(uris);
		instance.render();
	}

	private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
		this.panel = panel;
		this.extensionUri = extensionUri;
		this.panel.webview.html = this.getHtml();
		this.panel.webview.onDidReceiveMessage(msg => this.onMessage(msg), null, this.disposables);
		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
	}

	private dispose(): void {
		ConfigEditorPanel.panels.delete(this);
		while (this.disposables.length) {
			this.disposables.pop()?.dispose();
		}
	}

	// -----------------------------------------------------------------------
	// File loading
	// -----------------------------------------------------------------------

	private async addFiles(uris: vscode.Uri[]): Promise<void> {
		for (const uri of uris) {
			if (this.files.some(f => f.uri.toString() === uri.toString())) {
				continue; // already open
			}
			const format = detectFormat(uri);
			const bytes = await vscode.workspace.fs.readFile(uri);
			const entries = parseConfig(Buffer.from(bytes).toString('utf8'), format);
			for (const key of entries.keys()) {
				if (!this.keyOrder.includes(key)) {
					this.keyOrder.push(key);
				}
			}
			this.files.push({ uri, format, entries, dirty: false });
		}
		this.updateTitle();
	}

	private updateTitle(): void {
		const anyDirty = this.files.some(f => f.dirty);
		this.panel.title = `Config Editor${anyDirty ? ' \u25CF' : ''} (${this.files.length})`;
	}

	// -----------------------------------------------------------------------
	// Webview <-> extension messaging
	// -----------------------------------------------------------------------

	private async onMessage(message: any): Promise<void> {
		switch (message?.type) {
			case 'ready':
				this.render();
				break;
			case 'edit':
				this.handleEdit(message.uri, message.key, message.value);
				break;
			case 'save':
				await this.saveFile(message.uri);
				break;
			case 'saveAll':
				await Promise.all(this.files.filter(f => f.dirty).map(f => this.saveFile(f.uri.toString())));
				break;
			case 'addKey':
				this.handleAddKey(message.key);
				break;
			case 'removeKey':
				this.handleRemoveKey(message.key);
				break;
			case 'addFile':
				await this.handleAddFile();
				break;
			case 'removeFile':
				await this.handleRemoveFile(message.uri);
				break;
		}
	}

	private handleEdit(uriString: string, key: string, value: string): void {
		const file = this.files.find(f => f.uri.toString() === uriString);
		if (!file) {
			return;
		}
		if (file.entries.get(key) === value) {
			return; // no-op, avoid spurious dirty state
		}
		file.entries.set(key, value);
		if (!file.dirty) {
			file.dirty = true;
			this.updateTitle();
			void this.panel.webview.postMessage({ type: 'setDirty', uri: uriString, dirty: true });
		}
	}

	private handleAddKey(key: string): void {
		const trimmed = (key ?? '').trim();
		if (!trimmed || this.keyOrder.includes(trimmed)) {
			return;
		}
		this.keyOrder.push(trimmed);
		this.render();
	}

	private handleRemoveKey(key: string): void {
		const index = this.keyOrder.indexOf(key);
		if (index === -1) {
			return;
		}
		this.keyOrder.splice(index, 1);
		for (const file of this.files) {
			if (file.entries.delete(key)) {
				file.dirty = true;
			}
		}
		this.updateTitle();
		this.render();
	}

	private async handleAddFile(): Promise<void> {
		const picked = await vscode.window.showOpenDialog({
			canSelectMany: true,
			filters: OPEN_DIALOG_FILTERS,
			openLabel: 'Add as environment'
		});
		if (picked?.length) {
			await this.addFiles(picked);
			this.render();
		}
	}

	private async handleRemoveFile(uriString: string): Promise<void> {
		const file = this.files.find(f => f.uri.toString() === uriString);
		if (!file) {
			return;
		}
		const name = path.basename(file.uri.fsPath);
		if (file.dirty) {
			const choice = await vscode.window.showWarningMessage(
				`"${name}" has unsaved changes. Remove it from the editor anyway?`,
				{ modal: true },
				'Remove'
			);
			if (choice !== 'Remove') {
				return;
			}
		}
		this.files = this.files.filter(f => f !== file);
		this.render();
	}

	private async saveFile(uriString: string): Promise<void> {
		const file = this.files.find(f => f.uri.toString() === uriString);
		if (!file) {
			return;
		}
		const text = serializeConfig(file.entries, file.format);
		await vscode.workspace.fs.writeFile(file.uri, Buffer.from(text, 'utf8'));
		file.dirty = false;
		this.updateTitle();
		this.render();
	}

	// -----------------------------------------------------------------------
	// Rendering
	// -----------------------------------------------------------------------

	private render(): void {
		const state = {
			files: this.files.map(f => ({
				uri: f.uri.toString(),
				name: path.basename(f.uri.fsPath),
				dirty: f.dirty
			})),
			rows: this.keyOrder.map(key => ({
				key,
				values: Object.fromEntries(this.files.map(f => [f.uri.toString(), f.entries.get(key) ?? '']))
			}))
		};
		void this.panel.webview.postMessage({ type: 'init', state });
	}

	private getHtml(): string {
		const webview = this.panel.webview;
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.js'));
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.css'));
		const nonce = getNonce();
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link href="${styleUri}" rel="stylesheet">
	<title>Config Editor</title>
</head>
<body>
	<div id="toolbar">
		<button id="save-all">Save All</button>
		<button id="add-file">+ Add Environment</button>
	</div>
	<div id="table-container"></div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
