import * as path from 'path';
import * as os from 'os';

export function expandHome(input: string): string {
	if (input === '~') {
		return os.homedir();
	}
	if (input.startsWith('~/') || input.startsWith('~\\')) {
		return path.join(os.homedir(), input.slice(2));
	}
	return input;
}

export function getDefaultStorageRoot(): string {
	return path.join(os.homedir(), '.LLSOAI', 'History');
}

export function normalizeStorageRoot(storageRoot: string): string {
	return path.resolve(expandHome(storageRoot));
}

export function mapAbsolutePathToHistoryKey(filePath: string): string {
	const normalized = path.resolve(filePath);
	let key = normalized.replace(/\\/g, '/');
	key = key.replace(/:/g, '~~~~~');
	key = key.replace(/^\/+/, '');
	const parts = key.split('/').filter(part => part && part !== '.' && part !== '..' && !/[\x00-\x1f\x7f]/.test(part));
	return parts.join('/');
}

export function isInsidePath(child: string, parent: string): boolean {
	const relative = path.relative(path.resolve(parent), path.resolve(child));
	return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

export function getHistoryDirectory(storageRoot: string, filePath: string): string {
	const root = normalizeStorageRoot(storageRoot);
	const key = mapAbsolutePathToHistoryKey(filePath);
	const historyDir = path.resolve(root, key);
	if (!isInsidePath(historyDir, root)) {
		throw new Error('Mapped history path escapes storage root');
	}
	return historyDir;
}

export function getMetadataPath(storageRoot: string, filePath: string): string {
	return path.join(getHistoryDirectory(storageRoot, filePath), 'metadata.json');
}

export function getSnapshotsDirectory(storageRoot: string, filePath: string): string {
	return path.join(getHistoryDirectory(storageRoot, filePath), 'snapshots');
}
