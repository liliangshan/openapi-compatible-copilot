import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import * as path from 'path';
import { TimelineStorage } from './storage';
import { getDefaultStorageRoot, getHistoryDirectory, getSnapshotsDirectory, isInsidePath } from './pathMapper';
import { getGitInfo, isCurrentFileCommitted } from './git';
import { GitRepositoryWatcher } from './repoWatcher';
import {
	SaveSnapshotInput,
	TimelineGitCleanupInfo,
	TimelineGitRecord,
	TimelineListResult,
	TimelinePolicy,
	TimelineReadLinesResult,
	TimelineRestoreResult,
	TimelineSnapshotRecord,
	TimelineToolErrorCode,
} from './types';
import { decodeUtf8Text, makeTimelineError, pathExists, sha256, countLines, detectEol, hasTrailingNewline } from './utils';
import { execGit } from './git';

const TIMELINE_POLICY: TimelinePolicy = {
	enabled: true,
	storageRoot: getDefaultStorageRoot(),
	maxFileSizeMB: 2,
	maxSnapshotsPerFile: 20,
	cleanWhenCommitted: true,
	maxReadLines: 200,
	excludeGlobs: [
		'**/.git/**',
		'**/node_modules/**',
		'**/dist/**',
		'**/out/**',
		'**/build/**',
		'**/.env',
		'**/.env.*',
		'**/*.pem',
		'**/*.key',
		'**/*.p12',
		'**/*.pfx',
		'**/.ssh/**',
		'**/.aws/**',
		'**/.azure/**',
		'**/.kube/**',
		'**/secrets/**',
	],
};

export class TimelineService {
	private readonly storage = new TimelineStorage(TIMELINE_POLICY.storageRoot, TIMELINE_POLICY.maxSnapshotsPerFile);
	private readonly queues = new Map<string, Promise<void>>();
	private readonly deleteWatchers = new Set<vscode.FileSystemWatcher>();
	private readonly pendingDeletions = new Set<string>();

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly output: vscode.OutputChannel
	) {}

	register(): vscode.Disposable {
		const disposables: vscode.Disposable[] = [];
		disposables.push(vscode.workspace.onDidSaveTextDocument(document => {
			void this.enqueue(document.uri.fsPath, () => this.handleDidSave(document));
		}));
		// Listen for file open events to create snapshot if snapshots directory doesn't exist
		disposables.push(vscode.workspace.onDidOpenTextDocument(document => {
			void this.enqueue(document.uri.fsPath, () => this.handleDidOpen(document));
		}));
		const watcher = new GitRepositoryWatcher(this, this.output);
		disposables.push(watcher.register());
		disposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
			void watcher.refresh();
			void this.refreshDeleteWatchers();
		}));
		// Watch for deleted files in workspace folders
		void this.refreshDeleteWatchers();
		disposables.push(vscode.workspace.onDidDeleteFiles(event => {
			void this.handleFileDeletionEvent(event);
		}));
		return vscode.Disposable.from(...disposables, ...this.deleteWatchers);
	}

	async saveDocumentSnapshot(document: vscode.TextDocument, reason: SaveSnapshotInput['reason']): Promise<void> {
		if (document.uri.scheme !== 'file') {
			return;
		}
		const filePath = document.uri.fsPath;
		if (this.isExcluded(filePath)) {
			return;
		}
		const content = await fs.readFile(filePath);
		if (content.length > TIMELINE_POLICY.maxFileSizeMB * 1024 * 1024) {
			return;
		}
		const text = decodeUtf8Text(content);
		if (text === undefined) {
			return;
		}
		const workspaceFolder = this.getWorkspaceFolderForPath(filePath)?.uri.fsPath;
		const git = await getGitInfo(filePath);
		await this.storage.saveSnapshot({ filePath, content, reason, languageId: document.languageId, workspaceFolder, git });
	}

	async cleanIfCommitted(filePath: string): Promise<void> {
		if (!TIMELINE_POLICY.cleanWhenCommitted) {
			return;
		}
		if (await isCurrentFileCommitted(filePath)) {
			const git = await getGitInfo(filePath);
			await this.cleanCommittedFileHistory(filePath, {
				cleanedAt: new Date().toISOString(),
				repoRoot: git?.repoRoot,
				commit: git?.head,
				reason: 'saveClean',
				changedPath: git?.repoRoot ? path.relative(git.repoRoot, filePath).replace(/\\/g, '/') : undefined,
			});
		}
	}

	async cleanCommittedFileHistory(filePath: string, commitInfo: TimelineGitCleanupInfo): Promise<void> {
		await this.storage.cleanSnapshots(filePath, commitInfo, this.getWorkspaceFolderForPath(filePath)?.uri.fsPath);
	}

	async listSnapshotsByFile(filePath: string): Promise<TimelineListResult> {
		const absolutePath = await this.resolveToolFilePath(filePath, true);
		const metadata = await this.storage.listSnapshots(absolutePath);
		return {
			ok: true,
			filePath: absolutePath,
			sourceExists: await pathExists(absolutePath),
			metadataExists: !!metadata,
			metadataPath: this.storage.getMetadataPath(absolutePath),
			latest: metadata?.latest ?? null,
			records: metadata?.records ?? [],
			recordCount: metadata?.records.length ?? 0,
			restorable: (!!metadata?.latest && (metadata?.records.length ?? 0) > 0) || !!metadata?.deletedAt,
			lastGitCleanup: metadata?.lastGitCleanup ?? null,
			isDeleted: !!metadata?.deletedAt,
			deletedAt: metadata?.deletedAt,
			deletedCommit: metadata?.deletedCommit,
		};
	}

	async restoreSnapshotById(filePath: string, snapshotId: string, expectedSha256?: string): Promise<TimelineRestoreResult> {
		this.validateSnapshotId(snapshotId);
		const absolutePath = await this.resolveToolFilePath(filePath, true);
		const metadata = await this.storage.listSnapshots(absolutePath);

		// Handle deleted file restoration
		if (metadata?.deletedAt) {
			// Try to restore from a snapshot first
			let restoredFromSnapshot = false;
			let restoredContent: Buffer | undefined;
			let restoredRecord: TimelineSnapshotRecord | undefined;
			try {
				const { record, content } = await this.storage.readSnapshot(absolutePath, snapshotId);
				restoredContent = content;
				restoredRecord = record;
				restoredFromSnapshot = true;
			} catch {
				// Snapshot not available, try git show fallback
			}

			if (!restoredFromSnapshot) {
				if (!metadata.deletedCommit) {
					throw makeTimelineError('SNAPSHOT_CLEANED_BY_GIT', 'Snapshot has been cleaned and no git commit info available. File cannot be restored.');
				}
				// Try git show as fallback
				const gitContent = await this.getDeletedFileContentFromGit(absolutePath, metadata.deletedCommit);
				if (!gitContent) {
					throw makeTimelineError('SNAPSHOT_CLEANED_BY_GIT', 'Snapshot cleaned and git show also failed. File cannot be restored.');
				}
				restoredContent = gitContent;
				// Create a synthetic record for git content
				restoredRecord = {
					id: snapshotId,
					path: `git:${metadata.deletedCommit}`,
					savedAt: metadata.deletedAt,
					reason: 'deleted',
					sha256: sha256(gitContent),
					size: gitContent.length,
					lineCount: countLines(decodeUtf8Text(gitContent) ?? ''),
					eol: detectEol(decodeUtf8Text(gitContent) ?? ''),
					hasTrailingNewline: hasTrailingNewline(decodeUtf8Text(gitContent) ?? ''),
					encoding: 'utf8',
					isText: true,
				};
			}

			if (expectedSha256 && expectedSha256 !== restoredRecord!.sha256) {
				throw makeTimelineError('INVALID_ARGUMENT', 'expectedSha256 does not match snapshot sha256.');
			}

			// Check if file already exists - if so, save pre-restore snapshot first
			let createdPreRestoreSnapshot = false;
			if (await pathExists(absolutePath)) {
				const current = await fs.readFile(absolutePath);
				if (decodeUtf8Text(current) !== undefined) {
					await this.storage.saveSnapshot({
						filePath: absolutePath,
						content: current,
						reason: 'beforeRestore',
						workspaceFolder: this.getWorkspaceFolderForPath(absolutePath)?.uri.fsPath,
						git: await getGitInfo(absolutePath),
					});
					createdPreRestoreSnapshot = true;
				}
			}

			await fs.mkdir(path.dirname(absolutePath), { recursive: true });
			await fs.writeFile(absolutePath, restoredContent!, { mode: 0o600 });

			// Clear the deletedAt flag since we've restored the file
			await this.storage.clearDeletedFlag(absolutePath);

			return {
				ok: true,
				restored: true,
				filePath: absolutePath,
				snapshotId,
				sha256: sha256(restoredContent!),
				bytesWritten: restoredContent!.length,
				lineCount: restoredRecord!.lineCount,
				createdPreRestoreSnapshot,
			};
		}

		if (await isCurrentFileCommitted(absolutePath)) {
			throw makeTimelineError('GIT_PROTECTED_CLEAN_FILE', 'Refusing to restore a tracked clean file.');
		}
		const { record, content } = await this.storage.readSnapshot(absolutePath, snapshotId);
		if (!metadata?.latest || metadata?.records.length === 0) {
			throw makeTimelineError('SNAPSHOT_CLEANED_BY_GIT', 'Snapshot has been cleaned by Git.');
		}
		if (expectedSha256 && expectedSha256 !== record.sha256) {
			throw makeTimelineError('INVALID_ARGUMENT', 'expectedSha256 does not match snapshot sha256.');
		}
		let createdPreRestoreSnapshot = false;
		if (await pathExists(absolutePath)) {
			const current = await fs.readFile(absolutePath);
			if (decodeUtf8Text(current) !== undefined) {
				await this.storage.saveSnapshot({
					filePath: absolutePath,
					content: current,
					reason: 'beforeRestore',
					workspaceFolder: this.getWorkspaceFolderForPath(absolutePath)?.uri.fsPath,
					git: await getGitInfo(absolutePath),
				});
				createdPreRestoreSnapshot = true;
			}
		}
		await fs.mkdir(path.dirname(absolutePath), { recursive: true });
		await fs.writeFile(absolutePath, content, { mode: 0o600 });
		return {
			ok: true,
			restored: true,
			filePath: absolutePath,
			snapshotId,
			sha256: sha256(content),
			bytesWritten: content.length,
			lineCount: record.lineCount,
			createdPreRestoreSnapshot,
		};
	}

	async readSnapshotLines(filePath: string, snapshotId: string, startLine: number, lineCount: number): Promise<TimelineReadLinesResult> {
		this.validateSnapshotId(snapshotId);
		if (!Number.isInteger(startLine) || startLine < 1 || !Number.isInteger(lineCount) || lineCount < 1) {
			throw makeTimelineError('INVALID_ARGUMENT', 'startLine and lineCount must be positive integers.');
		}
		const requestedLineCount = lineCount;
		const effectiveLineCount = Math.min(lineCount, TIMELINE_POLICY.maxReadLines);
		const absolutePath = await this.resolveToolFilePath(filePath, true);
		const { record, content } = await this.storage.readSnapshot(absolutePath, snapshotId);
		const text = decodeUtf8Text(content);
		if (text === undefined) {
			throw makeTimelineError('SNAPSHOT_NOT_FOUND', 'Snapshot is not readable text.');
		}
		const lines = text.length === 0 ? [] : text.split(/\r\n|\r|\n/);
		const totalLines = lines.length;
		if (startLine > totalLines) {
			return { ok: true, filePath: absolutePath, snapshotId, startLine, endLine: startLine - 1, requestedLineCount, returnedLineCount: 0, totalLines, truncated: requestedLineCount > effectiveLineCount, content: '' };
		}
		const startIndex = startLine - 1;
		const selected = lines.slice(startIndex, startIndex + effectiveLineCount);
		return {
			ok: true,
			filePath: absolutePath,
			snapshotId,
			startLine,
			endLine: startLine + selected.length - 1,
			requestedLineCount,
			returnedLineCount: selected.length,
			totalLines: record.lineCount,
			truncated: requestedLineCount > effectiveLineCount,
			content: selected.join('\n'),
		};
	}

	private async handleDidSave(document: vscode.TextDocument): Promise<void> {
		try {
			await this.saveDocumentSnapshot(document, 'onDidSaveTextDocument');
			await this.cleanIfCommitted(document.uri.fsPath);
		} catch (error) {
			this.output.appendLine(`[timeline] save failed: ${String(error)}`);
		}
	}

	private async handleDidOpen(document: vscode.TextDocument): Promise<void> {
		try {
			// Only check if snapshots directory exists, create it and save snapshot if not
			await this.checkAndCreateSnapshotIfNeeded(document);
		} catch (error) {
			this.output.appendLine(`[timeline] open snapshot failed: ${String(error)}`);
		}
	}

	/**
	 * Check if snapshots directory exists for the file.
	 * If not, create the directory and save a snapshot.
	 */
	async checkAndCreateSnapshotIfNeeded(document: vscode.TextDocument): Promise<void> {
		if (document.uri.scheme !== 'file') {
			return;
		}
		const filePath = document.uri.fsPath;
		if (this.isExcluded(filePath)) {
			return;
		}

		// Check if snapshots directory exists
		const snapshotsDir = getSnapshotsDirectory(TIMELINE_POLICY.storageRoot, filePath);
		const exists = await pathExists(snapshotsDir);

		if (!exists) {
			// Directory doesn't exist, create it and save snapshot
			const content = await fs.readFile(filePath);
			const workspaceFolder = this.getWorkspaceFolderForPath(filePath)?.uri.fsPath;
			const git = await getGitInfo(filePath);
			await this.storage.saveSnapshot({
				filePath,
				content,
				reason: 'onDidOpenTextDocument',
				languageId: document.languageId,
				workspaceFolder,
				git,
			});
			this.output.appendLine(`[timeline] created snapshot for opened file: ${filePath}`);
		}
	}

	/**
	 * Check if snapshots directory exists for the file by path.
	 * If not, create the directory and save a snapshot.
	 * This method is designed to be called when tools like read_file are invoked.
	 * @param filePath The absolute file path to check and create snapshot for
	 */
	async checkAndCreateSnapshotByPath(filePath: string): Promise<void> {
		if (this.isExcluded(filePath)) {
			return;
		}

		// Check if snapshots directory exists
		const snapshotsDir = getSnapshotsDirectory(TIMELINE_POLICY.storageRoot, filePath);
		const exists = await pathExists(snapshotsDir);

		if (!exists) {
			// Directory doesn't exist, create it and save snapshot
			try {
				const content = await fs.readFile(filePath);
				const workspaceFolder = this.getWorkspaceFolderForPath(filePath)?.uri.fsPath;
				const git = await getGitInfo(filePath);
				// Try to get languageId from open document if available
				const document = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === filePath);
				const languageId = document?.languageId ?? '';
				await this.storage.saveSnapshot({
					filePath,
					content,
					reason: 'onDidOpenTextDocument',
					languageId,
					workspaceFolder,
					git,
				});
				this.output.appendLine(`[timeline] created snapshot for file path: ${filePath}`);
			} catch (error) {
				// File might not exist or be readable, just skip
				this.output.appendLine(`[timeline] failed to create snapshot for file path: ${filePath}, error: ${String(error)}`);
			}
		}
	}

	private async handleFileDeletionEvent(event: vscode.FileDeleteEvent): Promise<void> {
		for (const uri of event.files) {
			if (uri.scheme !== 'file') {
				continue;
			}
			const filePath = uri.fsPath;
			if (this.isExcluded(filePath)) {
				continue;
			}
			// Deduplicate: if multiple delete events fire for the same file
			if (this.pendingDeletions.has(filePath)) {
				continue;
			}
			this.pendingDeletions.add(filePath);
			try {
				// Try to read content from git (most reliable for tracked files)
				const git = await getGitInfo(filePath);
				if (git?.repoRoot && git?.head) {
					const relativePath = path.relative(git.repoRoot, filePath).replace(/\\/g, '/');
					try {
						const content = await this.getDeletedFileContentFromGit(filePath, git.head);
						if (content) {
							await this.markFileDeleted(filePath, content, git, 'deleted');
							continue;
						}
					} catch {
						// git show failed, try filesystem fallback
					}
				}
				// Fallback: try to read from filesystem (may succeed briefly after delete on some systems)
				try {
					const content = await fs.readFile(filePath);
					await this.markFileDeleted(filePath, content, git, 'deleted');
				} catch {
					// File already gone, but still record the deletion in metadata
					await this.markFileDeleted(filePath, undefined, git, 'deleted');
				}
			} catch (error) {
				this.output.appendLine(`[timeline] delete capture failed for ${filePath}: ${String(error)}`);
			} finally {
				this.pendingDeletions.delete(filePath);
			}
		}
	}

	async markFileDeleted(filePath: string, content: Buffer | undefined, git: TimelineGitRecord | undefined, reason: 'deleted'): Promise<void> {
		const workspaceFolder = this.getWorkspaceFolderForPath(filePath)?.uri.fsPath;
		const deletedAt = new Date().toISOString();
		const deletedCommit = git?.head;

		// If we have content, save a snapshot first
		if (content) {
			try {
				await this.storage.saveSnapshot({
					filePath,
					content,
					reason,
					workspaceFolder,
					git,
				});
			} catch (error) {
				this.output.appendLine(`[timeline] failed to save deleted file snapshot: ${String(error)}`);
			}
		}

		// Update metadata to mark file as deleted
		await this.storage.markFileDeleted(filePath, deletedAt, deletedCommit, workspaceFolder);
		this.output.appendLine(`[timeline] marked file deleted: ${filePath} (commit: ${deletedCommit ?? 'uncommitted/untracked'})`);
	}

	private async getDeletedFileContentFromGit(filePath: string, commit: string): Promise<Buffer | undefined> {
		const git = await getGitInfo(filePath);
		if (!git?.repoRoot) {
			return undefined;
		}
		const relativePath = path.relative(git.repoRoot, filePath).replace(/\\/g, '/');
		try {
			const result = await execGit(git.repoRoot, ['show', `${commit}:${relativePath}`]);
			if (result.exitCode === 0) {
				return result.stdout;
			}
		} catch {
			// git show failed
		}
		return undefined;
	}

	private async refreshDeleteWatchers(): Promise<void> {
		// Dispose old watchers
		for (const watcher of this.deleteWatchers) {
			watcher.dispose();
		}
		this.deleteWatchers.clear();

		// Create new watchers for each workspace folder
		const folders = vscode.workspace.workspaceFolders ?? [];
		for (const folder of folders) {
			if (folder.uri.scheme !== 'file') {
				continue;
			}
			// Watch for deletions recursively in the workspace folder
			const watcher = vscode.workspace.createFileSystemWatcher(
				new vscode.RelativePattern(folder.uri, '**'),
				false,  // ignoreCreateEvents
				false,  // ignoreChangeEvents
				false   // ignoreDeleteEvents = false (we want to watch deletes)
			);
			this.deleteWatchers.add(watcher);
		}
	}

	private async enqueue(filePath: string, task: () => Promise<void>): Promise<void> {
		const previous = this.queues.get(filePath) ?? Promise.resolve();
		const next = previous.then(task, task).finally(() => {
			if (this.queues.get(filePath) === next) {
				this.queues.delete(filePath);
			}
		});
		this.queues.set(filePath, next);
		await next;
	}

	private isExcluded(filePath: string): boolean {
		const normalized = filePath.replace(/\\/g, '/');
		return TIMELINE_POLICY.excludeGlobs.some(pattern => {
			const token = pattern.replace(/^\*\*\//, '').replace(/\/\*\*$/, '');
			if (pattern.includes('*')) {
				if (pattern.endsWith('/**')) {
					return normalized.includes(`/${token.replace(/\/$/, '')}/`);
				}
				if (pattern.startsWith('**/*.')) {
					return normalized.endsWith(pattern.slice(4));
				}
				return normalized.endsWith(token.replace('*', '')) || normalized.includes(`/${token.replace('*', '')}`);
			}
			return normalized.endsWith(token) || normalized.includes(`/${token}`);
		});
	}

	private getWorkspaceFolderForPath(filePath: string): vscode.WorkspaceFolder | undefined {
		return vscode.workspace.workspaceFolders?.find(folder => folder.uri.scheme === 'file' && isInsidePath(filePath, folder.uri.fsPath));
	}

	private async resolveToolFilePath(filePath: string, allowExistingMetadata: boolean): Promise<string> {
		if (!filePath || typeof filePath !== 'string') {
			throw makeTimelineError('INVALID_ARGUMENT', 'filePath is required.');
		}
		let absolutePath: string;
		if (path.isAbsolute(filePath)) {
			absolutePath = path.resolve(filePath);
		} else {
			const folders = vscode.workspace.workspaceFolders?.filter(folder => folder.uri.scheme === 'file') ?? [];
			const candidates = folders
				.map(folder => path.resolve(folder.uri.fsPath, filePath));
			if (candidates.length !== 1) {
				throw makeTimelineError('FILE_NOT_IN_WORKSPACE', 'Relative filePath must resolve to exactly one workspace file. Use an absolute path when multiple workspace folders could match.');
			}
			absolutePath = candidates[0];
		}
		const workspace = this.getWorkspaceFolderForPath(absolutePath);
		if (workspace) {
			return absolutePath;
		}
		if (allowExistingMetadata) {
			const metadata = await this.storage.listSnapshots(absolutePath);
			if (metadata && path.resolve(metadata.canonicalPath) === absolutePath) {
				return absolutePath;
			}
		}
		throw makeTimelineError('FILE_NOT_IN_WORKSPACE', 'filePath is outside the current workspace.');
	}

	private validateSnapshotId(snapshotId: string): void {
		if (!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.[a-f0-9]{8,16}$/.test(snapshotId)) {
			throw makeTimelineError('INVALID_ARGUMENT', 'Invalid snapshotId.');
		}
	}

	async isFileMarkedDeleted(filePath: string): Promise<boolean> {
		try {
			const absolutePath = await this.resolveToolFilePath(filePath, false);
			const metadata = await this.storage.listSnapshots(absolutePath);
			return !!metadata?.deletedAt;
		} catch {
			return false;
		}
	}

	/**
	 * Capture a deleted file's content from git before cleanup.
	 * This is called when a file is deleted in a git commit.
	 */
	async captureDeletedFileFromGit(filePath: string, commit: string, relativePath: string): Promise<void> {
		const git = await getGitInfo(filePath);
		if (!git?.repoRoot) {
			return;
		}

		// Get content from the previous commit
		const content = await this.getDeletedFileContentFromGit(filePath, commit);
		if (!content) {
			// File might not have existed in that commit or git show failed
			this.output.appendLine(`[timeline] could not get content from git for ${filePath} at ${commit}`);
			return;
		}

		await this.markFileDeleted(filePath, content, git, 'deleted');
		this.output.appendLine(`[timeline] captured deleted file from git: ${filePath}`);
	}
}

export function timelineErrorToJson(error: unknown): string {
	const maybe = error as { code?: TimelineToolErrorCode; retryable?: boolean; message?: string };
	return JSON.stringify({
		ok: false,
		error: {
			code: maybe.code ?? 'INTERNAL_ERROR',
			message: maybe.message ?? String(error),
			retryable: maybe.retryable ?? false,
		},
	});
}
