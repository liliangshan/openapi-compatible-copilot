import { promises as fs } from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import type { ChangedPath, GitDirectories, TimelineGitRecord } from './types';

function runGit(cwd: string, args: string[], timeoutMs = 3000): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn('git', ['-C', cwd, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error(`git ${args.join(' ')} timed out`));
		}, timeoutMs);
		child.stdout.on('data', chunk => stdout += String(chunk));
		child.stderr.on('data', chunk => stderr += String(chunk));
		child.on('error', error => {
			clearTimeout(timer);
			reject(error);
		});
		child.on('close', code => {
			clearTimeout(timer);
			if (code === 0) {
				resolve(stdout);
			} else {
				reject(new Error(stderr.trim() || `git ${args.join(' ')} exited with ${code}`));
			}
		});
	});
}

export async function execGit(cwd: string, args: string[], timeoutMs = 3000): Promise<{ exitCode: number; stdout: Buffer; stderr: string }> {
	return new Promise(resolve => {
		const child = spawn('git', ['-C', cwd, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
		const chunks: Buffer[] = [];
		let stderr = '';
		let settled = false;

		const finish = (result: { exitCode: number; stdout: Buffer; stderr: string }) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			resolve(result);
		};

		const timer = setTimeout(() => {
			child.kill();
			finish({ exitCode: -1, stdout: Buffer.concat(chunks), stderr: 'timeout' });
		}, timeoutMs);

		child.stdout.on('data', chunk => {
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		});

		child.stderr.on('data', chunk => {
			stderr += String(chunk);
		});

		child.on('error', error => {
			finish({ exitCode: -1, stdout: Buffer.concat(chunks), stderr: String(error) });
		});

		child.on('close', code => {
			finish({ exitCode: code ?? -1, stdout: Buffer.concat(chunks), stderr });
		});
	});
}

export async function getRepoRoot(fileOrDir: string): Promise<string | undefined> {
	try {
		const stat = await fs.stat(fileOrDir).catch(() => undefined);
		const cwd = stat?.isDirectory() ? fileOrDir : path.dirname(fileOrDir);
		return path.resolve((await runGit(cwd, ['rev-parse', '--show-toplevel'])).trim());
	} catch {
		return undefined;
	}
}

export async function getCurrentHead(repoRoot: string): Promise<string | undefined> {
	try {
		return (await runGit(repoRoot, ['rev-parse', '--verify', 'HEAD'])).trim();
	} catch {
		return undefined;
	}
}

export async function resolveGitDirectories(repoRoot: string): Promise<GitDirectories> {
	const gitDirRaw = (await runGit(repoRoot, ['rev-parse', '--git-dir'])).trim();
	const commonGitDirRaw = (await runGit(repoRoot, ['rev-parse', '--git-common-dir'])).trim();
	return {
		gitDir: path.resolve(repoRoot, gitDirRaw),
		commonGitDir: path.resolve(repoRoot, commonGitDirRaw),
	};
}

export async function getGitInfo(filePath: string): Promise<TimelineGitRecord | undefined> {
	const repoRoot = await getRepoRoot(filePath);
	if (!repoRoot) {
		return undefined;
	}
	const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
	const head = await getCurrentHead(repoRoot);
	let isTracked = false;
	try {
		await runGit(repoRoot, ['ls-files', '--error-unmatch', '--', relativePath]);
		isTracked = true;
	} catch {
		isTracked = false;
	}
	let status = '';
	try {
		status = await runGit(repoRoot, ['status', '--porcelain=v1', '--untracked-files=all', '--', relativePath]);
	} catch {
		status = '';
	}
	return { repoRoot, head, isTracked, status: status.trim() || 'clean' };
}

export async function isCurrentFileCommitted(filePath: string): Promise<boolean> {
	const repoRoot = await getRepoRoot(filePath);
	if (!repoRoot) {
		return false;
	}
	const head = await getCurrentHead(repoRoot);
	if (!head) {
		return false;
	}
	const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
	try {
		await runGit(repoRoot, ['ls-files', '--error-unmatch', '--', relativePath]);
		const status = await runGit(repoRoot, ['status', '--porcelain=v1', '--untracked-files=no', '--', relativePath]);
		return status.trim() === '';
	} catch {
		return false;
	}
}

async function gitPathExistsInHead(repoRoot: string, relativePath: string): Promise<boolean> {
	try {
		await runGit(repoRoot, ['cat-file', '-e', `HEAD:${relativePath}`]);
		return true;
	} catch {
		return false;
	}
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.stat(filePath);
		return true;
	} catch {
		return false;
	}
}

export async function isPathSafeToCleanAfterCommit(repoRoot: string, relativePath: string): Promise<boolean> {
	try {
		const status = await runGit(repoRoot, ['status', '--porcelain=v1', '--untracked-files=all', '--', relativePath]);
		if (status.trim() !== '') {
			return false;
		}
		if (await gitPathExistsInHead(repoRoot, relativePath)) {
			return true;
		}
		return !(await fileExists(path.join(repoRoot, relativePath)));
	} catch {
		return false;
	}
}

export async function getCommittedChangedPaths(repoRoot: string, oldHead: string | undefined, newHead: string): Promise<ChangedPath[]> {
	const args = oldHead
		? ['diff-tree', '--no-commit-id', '--name-status', '-r', '-M', '-z', oldHead, newHead]
		: ['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', '-M', '-z', newHead];
	const output = await runGit(repoRoot, args, 5000);
	return parseNameStatus(output);
}

function parseNameStatus(output: string): ChangedPath[] {
	const parts = output.split('\0').filter(Boolean);
	const result: ChangedPath[] = [];
	for (let i = 0; i < parts.length;) {
		const status = parts[i++];
		if (!status) {
			break;
		}
		if (status.startsWith('R') || status.startsWith('C')) {
			const oldPath = parts[i++];
			const newPath = parts[i++];
			if (oldPath && newPath) {
				result.push({ status, oldPath, path: newPath });
			}
		} else {
			const filePath = parts[i++];
			if (filePath) {
				result.push({ status, path: filePath });
			}
		}
	}
	const seen = new Set<string>();
	return result.filter(item => {
		const key = `${item.status}:${item.oldPath ?? ''}:${item.path}`;
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}
