import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigEntries, ConfigFormat, detectFormat, parseConfig, serializeConfig } from './configParser';
import { readGitHeadContent } from './gitBaseline';

interface FileState {
	uri: vscode.Uri;
	format: ConfigFormat;
	entries: ConfigEntries;
	/** Snapshot of `entries` as last read from / written to disk - used to detect unsaved edits. */
	savedEntries: ConfigEntries;
	/** Snapshot parsed from the file's git HEAD content, if a git baseline is available. */
	gitEntries: ConfigEntries | undefined;
	dirty: boolean;
}

/** A node in the display tree built from dot-separated keys (e.g. "api.url" -> section "api" > leaf "url"). */
interface UiTreeNode {
	path: string;
	name: string;
	children: UiTreeNode[];
	values?: Record<string, string>;
	/** URIs of files where this field is absent (only set when at least one other file has it). */
	missingIn?: string[];
	/** URIs of files where this field's position doesn't match the canonical key order. */
	misplacedIn?: string[];
	/** URIs of files where this field has been edited but not saved to disk. */
	unsavedIn?: string[];
	/** URIs of files where this field is saved to disk but differs from the git HEAD version. */
	uncommittedIn?: string[];
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
		// Catches the common case of committing/switching branches in Source Control, then tabbing back here.
		this.panel.onDidChangeViewState(e => {
			if (e.webviewPanel.visible) {
				void this.refreshGitBaselines();
			}
		}, null, this.disposables);
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
			const file: FileState = { uri, format, entries, savedEntries: new Map(entries), gitEntries: undefined, dirty: false };
			this.files.push(file);
			void this.loadGitBaseline(file).then(() => this.render());
		}
		this.updateTitle();
	}

	/** Fetches (or clears) the git HEAD snapshot used to detect uncommitted-but-saved changes. */
	private async loadGitBaseline(file: FileState): Promise<void> {
		const headText = await readGitHeadContent(file.uri);
		file.gitEntries = headText !== undefined ? parseConfig(headText, file.format) : undefined;
	}

	private async refreshGitBaselines(): Promise<void> {
		await Promise.all(this.files.map(f => this.loadGitBaseline(f)));
		this.render();
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
			case 'removeSection':
				this.handleRemoveSection(message.path);
				break;
			case 'addFile':
				await this.handleAddFile();
				break;
			case 'removeFile':
				await this.handleRemoveFile(message.uri);
				break;
			case 'reload':
				await this.reloadAllFiles();
				break;
			case 'openFile':
				await this.openFile(message.uri);
				break;
			case 'goToEntry':
				await this.goToEntry(message.uri, message.key);
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
		// Lightweight, cell-scoped update (like setDirty above) instead of a full render()
		// so we don't steal focus from the input the user is still typing in.
		const unsaved = file.entries.get(key) !== file.savedEntries.get(key);
		void this.panel.webview.postMessage({ type: 'setUnsaved', uri: uriString, key, unsaved });
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

	/** Removes a section and every leaf key nested under it (path itself or "path.*"). */
	private handleRemoveSection(sectionPath: string): void {
		const prefix = `${sectionPath}.`;
		const toRemove = this.keyOrder.filter(key => key === sectionPath || key.startsWith(prefix));
		if (toRemove.length === 0) {
			return;
		}
		this.keyOrder = this.keyOrder.filter(key => !toRemove.includes(key));
		for (const file of this.files) {
			for (const key of toRemove) {
				if (file.entries.delete(key)) {
					file.dirty = true;
				}
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
		file.savedEntries = new Map(file.entries);
		file.dirty = false;
		this.updateTitle();
		this.render();
	}

	/** Re-reads every open file from disk, discarding in-memory edits, then refreshes the git baseline. */
	private async reloadAllFiles(): Promise<void> {
		const dirtyFiles = this.files.filter(f => f.dirty);
		if (dirtyFiles.length > 0) {
			const names = dirtyFiles.map(f => path.basename(f.uri.fsPath)).join(', ');
			const choice = await vscode.window.showWarningMessage(
				`Reload from disk? Unsaved changes in ${names} will be lost.`,
				{ modal: true },
				'Reload'
			);
			if (choice !== 'Reload') {
				return;
			}
		}

		for (const file of this.files) {
			const bytes = await vscode.workspace.fs.readFile(file.uri);
			const entries = parseConfig(Buffer.from(bytes).toString('utf8'), file.format);
			for (const key of entries.keys()) {
				if (!this.keyOrder.includes(key)) {
					this.keyOrder.push(key);
				}
			}
			file.entries = entries;
			file.savedEntries = new Map(entries);
			file.dirty = false;
		}
		this.updateTitle();
		await this.refreshGitBaselines(); // also re-renders
	}

	private async openFile(uriString: string): Promise<void> {
		const file = this.files.find(f => f.uri.toString() === uriString);
		if (!file) {
			return;
		}
		const document = await vscode.workspace.openTextDocument(file.uri);
		await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside });
	}

	/** Opens the file beside the panel and selects the line where this field is (approximately) defined. */
	private async goToEntry(uriString: string, key: string): Promise<void> {
		const file = this.files.find(f => f.uri.toString() === uriString);
		if (!file) {
			return;
		}
		const document = await vscode.workspace.openTextDocument(file.uri);
		const editor = await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Beside });

		const lineIndex = findLineForKey(document.getText(), file.format, key);
		if (lineIndex === -1) {
			return;
		}
		const range = document.lineAt(lineIndex).range;
		editor.selection = new vscode.Selection(range.start, range.end);
		editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
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
			tree: this.buildTree()
		};
		void this.panel.webview.postMessage({ type: 'init', state });
	}

	/** Groups dot-separated keys into a nested tree so parent segments render as sections. */
	private buildTree(): UiTreeNode[] {
		const roots: UiTreeNode[] = [];
		const nodeByPath = new Map<string, UiTreeNode>();

		for (const key of this.keyOrder) {
			const segments = key.split('.');
			let currentPath = '';
			let siblings = roots;
			for (const segment of segments) {
				currentPath = currentPath ? `${currentPath}.${segment}` : segment;
				let node = nodeByPath.get(currentPath);
				if (!node) {
					node = { path: currentPath, name: segment, children: [] };
					nodeByPath.set(currentPath, node);
					siblings.push(node);
				}
				siblings = node.children;
			}
		}

		const misplacedByFile = this.findMisplacedKeys();
		const misplacedSectionsByFile = this.findMisplacedSections();

		// A node is a leaf (has an editable value per file) only if it has no children.
		for (const [nodePath, node] of nodeByPath) {
			if (node.children.length === 0) {
				node.values = Object.fromEntries(this.files.map(f => [f.uri.toString(), f.entries.get(nodePath) ?? '']));

				const presentIn = this.files.filter(f => f.entries.has(nodePath));
				if (presentIn.length > 0 && presentIn.length < this.files.length) {
					node.missingIn = this.files.filter(f => !f.entries.has(nodePath)).map(f => f.uri.toString());
				}

				const misplacedIn = this.files
					.filter(f => misplacedByFile.get(f.uri.toString())?.has(nodePath))
					.map(f => f.uri.toString());
				if (misplacedIn.length > 0) {
					node.misplacedIn = misplacedIn;
				}

				const unsavedIn = this.files
					.filter(f => f.entries.get(nodePath) !== f.savedEntries.get(nodePath))
					.map(f => f.uri.toString());
				if (unsavedIn.length > 0) {
					node.unsavedIn = unsavedIn;
				}

				const uncommittedIn = this.files
					.filter(f => f.gitEntries !== undefined && f.savedEntries.get(nodePath) !== f.gitEntries.get(nodePath))
					.map(f => f.uri.toString());
				if (uncommittedIn.length > 0) {
					node.uncommittedIn = uncommittedIn;
				}
			}
		}

		// Whole sections (top-level groups) can also be reordered as a block; flag those separately
		// from individual field mismatches, since a section row has no per-field values of its own.
		for (const node of roots) {
			if (node.children.length > 0) {
				const misplacedIn = this.files
					.filter(f => misplacedSectionsByFile.get(f.uri.toString())?.has(node.path))
					.map(f => f.uri.toString());
				if (misplacedIn.length > 0) {
					node.misplacedIn = misplacedIn;
				}
			}
		}

		return roots;
	}

	/**
	 * Same idea as findMisplacedKeys(), but at the top-level-section granularity: each key is
	 * reduced to its first path segment (e.g. "database.host" -> "database") before comparing a
	 * file's actual vs. canonical order, so a whole section moved as a block gets flagged even if
	 * its own internal field order didn't change.
	 */
	private findMisplacedSections(): Map<string, Set<string>> {
		const result = new Map<string, Set<string>>();
		const topLevelOf = (key: string) => key.split('.')[0];

		for (const file of this.files) {
			const expectedOrder = uniqueInOrder(this.keyOrder.filter(key => file.entries.has(key)).map(topLevelOf));
			const actualOrder = uniqueInOrder([...file.entries.keys()].map(topLevelOf));
			const misplaced = new Set<string>();
			for (let i = 0; i < actualOrder.length; i++) {
				if (actualOrder[i] !== expectedOrder[i]) {
					misplaced.add(actualOrder[i]);
				}
			}
			if (misplaced.size > 0) {
				result.set(file.uri.toString(), misplaced);
			}
		}
		return result;
	}

	/**
	 * For each file, compares the order its fields actually appear in against the order they'd be in
	 * if the canonical `keyOrder` were filtered down to just that file's fields. Any field whose
	 * position differs between the two is "misplaced" relative to the other open files.
	 */
	private findMisplacedKeys(): Map<string, Set<string>> {
		const result = new Map<string, Set<string>>();
		for (const file of this.files) {
			const expectedOrder = this.keyOrder.filter(key => file.entries.has(key));
			const actualOrder = [...file.entries.keys()];
			const misplaced = new Set<string>();
			for (let i = 0; i < actualOrder.length; i++) {
				if (actualOrder[i] !== expectedOrder[i]) {
					misplaced.add(actualOrder[i]);
				}
			}
			if (misplaced.size > 0) {
				result.set(file.uri.toString(), misplaced);
			}
		}
		return result;
	}

	private getHtml(): string {
		const webview = this.panel.webview;
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.js'));
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.css'));
		const htmlPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'main.html').fsPath;
		const nonce = getNonce();

		return fs.readFileSync(htmlPath, 'utf8')
			.replace(/{{cspSource}}/g, webview.cspSource)
			.replace(/{{nonce}}/g, nonce)
			.replace('{{styleUri}}', styleUri.toString())
			.replace('{{scriptUri}}', scriptUri.toString());
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

/** De-duplicates a list while preserving each item's first-seen order. */
function uniqueInOrder(items: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const item of items) {
		if (!seen.has(item)) {
			seen.add(item);
			out.push(item);
		}
	}
	return out;
}

/**
 * Finds the (0-based) line where a field is likely defined, for "Go to Entry". Formats whose dot-path
 * is only a display grouping (JSON, YAML, INI sections) match on the key's last segment instead of the
 * full path - an approximation, since none of them carry an exact 1:1 line mapping back to our flattened keys.
 */
function findLineForKey(text: string, format: ConfigFormat, key: string): number {
	const lines = text.split(/\r\n|\r|\n/);
	const leaf = key.split('.').pop() ?? key;

	if (format === 'json') {
		const pattern = new RegExp(`"${escapeRegExp(leaf)}"\\s*:`);
		return lines.findIndex(line => pattern.test(line));
	}
	if (format === 'yaml') {
		const pattern = new RegExp(`^\\s*"?${escapeRegExp(leaf)}"?\\s*:`);
		return lines.findIndex(line => pattern.test(line));
	}
	if (format === 'ini') {
		const pattern = new RegExp(`^\\s*${escapeRegExp(leaf)}\\s*[:=]`);
		return lines.findIndex(line => pattern.test(line));
	}
	const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*[:=]`);
	return lines.findIndex(line => pattern.test(line));
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
