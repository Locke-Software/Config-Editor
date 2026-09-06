// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ConfigEditorPanel } from './configEditorPanel';

const CONFIG_FILE_FILTERS: Record<string, string[]> = {
	'Config files': ['json', 'env', 'ini', 'properties', 'cfg', 'conf', 'yaml', 'yml', 'txt'],
	'All files': ['*']
};

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "configeditor" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('configeditor.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from ConfigEditor!');
	});

	// Opens one or more configuration files (e.g. one per environment) side by side
	// as columns in a single table-style custom editor.
	const openConfigFiles = vscode.commands.registerCommand(
		'configeditor.openConfigFiles',
		async (clickedUri?: vscode.Uri, selectedUris?: vscode.Uri[]) => {
			let uris = selectedUris?.length ? selectedUris : clickedUri ? [clickedUri] : undefined;

			if (!uris?.length) {
				uris = await vscode.window.showOpenDialog({
					canSelectMany: true,
					filters: CONFIG_FILE_FILTERS,
					openLabel: 'Open in Config Editor'
				});
			}

			if (!uris?.length) {
				return;
			}

			await ConfigEditorPanel.createOrShow(context.extensionUri, uris);
		}
	);

	context.subscriptions.push(disposable, openConfigFiles);
}

// This method is called when your extension is deactivated
export function deactivate() {}

