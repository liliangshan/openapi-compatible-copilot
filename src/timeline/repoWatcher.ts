import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import * as crypto from 'crypto';
import type { TimelineGitCleanupInfo } from './types';
import { getCommittedChangedPaths, getCurrentHead, isPathSafeToCleanAfterCommit, resolveGitDirectories, getRepoRoot } from './git';
import { getDefaultStorageRoot } from './pathMapper';
import { atomicWriteFile } from './utils';
import type { TimelineService } from './service';

export class GitRepositoryWatcher implements vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = [];
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
	private disposed = false;
	private readonly watchedRepos = new Set<string>();

	constructor(
		private readonly service: TimelineService,
		private readonly output: vscode.OutputChannel
	) {}

	register(): vscode.Disposable {
		void this.refresh().catch(error => this.output.appendLine(`[timeline] repo watcher init failed: ${String(error)}`));
		return this;
	}

	dispose(): void {
		this.disposed = true;
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		this.timers.clear();
		vscode.Disposable.from(...this.disposables).dispose();
		this.disposables.length = 0;
	}

	async refresh(): Promise<void> {
		const folders = vscode.workspace.workspaceFolders ?? [];
		for (const folder of folders) {
			if (folder.uri.scheme !== 'file') {
				continue;
			}
			const repoRoot = await getRepoRoot(folder.uri.fsPath);
			if (repoRoot && !this.watchedRepos.has(repoRoot)) {
				this.watchedRepos.add(repoRoot);
				await this.watchRepo(repoRoot);
			}
		}
	}

	private async watchRepo(repoRoot: string): Promise<void> {
		if (this.disposed) {
			return;
		}
		const gitDirs = await resolveGitDirectories(repoRoot);
		this.watch(repoRoot, gitDirs.gitDir, 'HEAD');
		this.watch(repoRoot, gitDirs.commonGitDir, 'packed-refs');
		this.watch(repoRoot, gitDirs.commonGitDir, 'refs/heads/**');
		if (path.resolve(gitDirs.gitDir) !== path.resolve(gitDirs.commonGitDir)) {
			this.watch(repoRoot, gitDirs.gitDir, 'packed-refs');
			this.watch(repoRoot, gitDirs.gitDir, 'refs/heads/**');
		}
		const head = await getCurrentHead(repoRoot);
		if (head) {
			const oldHead = await this.readLastProcessedHead(repoRoot);
			if (oldHead && oldHead !== head) {
				await this.handleRepoChanged(repoRoot, oldHead, head);
			} else if (!oldHead) {
				await this.writeLastProcessedHead(repoRoot, head);
			}
		}
	}

	private watch(repoRoot: string, base: string, pattern: string): void {
		if (this.disposed) {
			return;
		}
		const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(base), pattern), false, false, false);
		const schedule = () => this.scheduleRepoRefresh(repoRoot);
		this.addDisposable(watcher);
		this.addDisposable(watcher.onDidCreate(schedule));
		this.addDisposable(watcher.onDidChange(schedule));
		this.addDisposable(watcher.onDidDelete(schedule));
	}

	private addDisposable(disposable: vscode.Disposable): void {
		if (this.disposed) {
			disposable.dispose();
			return;
		}
		this.disposables.push(disposable);
	}

	private scheduleRepoRefresh(repoRoot: string): void {
		if (this.disposed) {
			return;
		}
		const oldTimer = this.timers.get(repoRoot);
		if (oldTimer) {
			clearTimeout(oldTimer);
		}
		const timer = setTimeout(() => {
			this.timers.delete(repoRoot);
			if (!this.disposed) {
				void this.handleRepoMaybeChanged(repoRoot);
			}
		}, 300);
		this.timers.set(repoRoot, timer);
	}

	private async handleRepoMaybeChanged(repoRoot: string): Promise<void> {
		try {
			const oldHead = await this.readLastProcessedHead(repoRoot);
			const newHead = await getCurrentHead(repoRoot);
			if (!newHead || oldHead === newHead) {
				return;
			}
			await this.handleRepoChanged(repoRoot, oldHead, newHead);
			await this.writeLastProcessedHead(repoRoot, newHead);
		} catch (error) {
			this.output.appendLine(`[timeline] repo watcher failed: ${String(error)}`);
		}
	}

	private async handleRepoChanged(repoRoot: string, oldHead: string | undefined, newHead: string): Promise<void> {
		const changedPaths = await getCommittedChangedPaths(repoRoot, oldHead, newHead);
		for (const changedPath of changedPaths) {
			const paths = [changedPath.path, changedPath.oldPath].filter(Boolean) as string[];
			for (const relativePath of paths) {
				try {
					const absolutePath = path.join(repoRoot, relativePath);
					// Skip cleanup for files that have been marked as deleted - we need to preserve their metadata
					if (await this.service.isFileMarkedDeleted(absolutePath)) {
						continue;
					}

					// Handle file deletion (status "D"): capture content from old commit before cleanup
					if (changedPath.status === 'D' && oldHead) {
						try {
							await this.service.captureDeletedFileFromGit(absolutePath, oldHead, relativePath);
						} catch (error) {
							this.output.appendLine(`[timeline] failed to capture deleted file ${relativePath}: ${String(error)}`);
						}
					}

					if (await isPathSafeToCleanAfterCommit(repoRoot, relativePath)) {
						const info: TimelineGitCleanupInfo = {
							cleanedAt: new Date().toISOString(),
							repoRoot,
							commit: newHead,
							reason: 'gitCommit',
							changedPath: relativePath,
						};
						await this.service.cleanCommittedFileHistory(absolutePath, info);
					}
				} catch (error) {
					this.output.appendLine(`[timeline] cleanup failed for ${relativePath}: ${String(error)}`);
				}
			}
		}
	}

	private getRepoStatePath(repoRoot: string): string {
		const hash = crypto.createHash('sha256').update(repoRoot).digest('hex').slice(0, 16);
		return path.join(getDefaultStorageRoot(), '.repos', `${hash}.json`);
	}

	private async readLastProcessedHead(repoRoot: string): Promise<string | undefined> {
		try {
			const data = JSON.parse(await fs.readFile(this.getRepoStatePath(repoRoot), 'utf8')) as { lastProcessedHead?: string };
			return data.lastProcessedHead;
		} catch {
			return undefined;
		}
	}

	private async writeLastProcessedHead(repoRoot: string, head: string): Promise<void> {
		const statePath = this.getRepoStatePath(repoRoot);
		await atomicWriteFile(statePath, JSON.stringify({
			repoRoot,
			repoHash: path.basename(statePath, '.json'),
			lastProcessedHead: head,
			updatedAt: new Date().toISOString(),
		}, null, 2), 0o600);
	}
}
