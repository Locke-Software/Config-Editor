import * as vscode from 'vscode';

// Minimal hand-rolled subset of the built-in 'vscode.git' extension's API -
// just enough to read a file's content at HEAD. No @types package is used
// for it, so every call site treats failures as "no git baseline available".
interface GitRepository {
	rootUri: vscode.Uri;
	show(ref: string, path: string): Promise<string>;
}

interface GitApi {
	repositories: GitRepository[];
	getRepository(uri: vscode.Uri): GitRepository | null;
}

interface GitExtensionExports {
	getAPI(version: 1): GitApi;
}

let cachedApi: GitApi | undefined;

async function getGitApi(): Promise<GitApi | undefined> {
	if (cachedApi) {
		return cachedApi;
	}
	const extension = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
	if (!extension) {
		return undefined;
	}
	try {
		const exports = extension.isActive ? extension.exports : await extension.activate();
		cachedApi = exports.getAPI(1);
		return cachedApi;
	} catch {
		return undefined;
	}
}

/** Returns the file's content at HEAD, or undefined if there's no git repo/commit/tracked file to compare against. */
export async function readGitHeadContent(uri: vscode.Uri): Promise<string | undefined> {
	const api = await getGitApi();
	const repo = api?.getRepository(uri);
	if (!repo) {
		return undefined;
	}
	try {
		return await repo.show('HEAD', uri.fsPath);
	} catch {
		return undefined; // e.g. untracked file, or repo has no commits yet
	}
}
