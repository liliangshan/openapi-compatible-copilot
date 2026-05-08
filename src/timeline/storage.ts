import { promises as fs } from 'fs';
import * as path from 'path';
import {
	SaveSnapshotInput,
	TimelineGitCleanupInfo,
	TimelineMetadata,
	TimelineSnapshotRecord,
} from './types';
import {
	getHistoryDirectory,
	getMetadataPath,
	getSnapshotsDirectory,
	mapAbsolutePathToHistoryKey,
	normalizeStorageRoot,
	isInsidePath,
} from './pathMapper';
import {
	atomicWriteFile,
	countLines,
	decodeUtf8Text,
	detectEol,
	hasTrailingNewline,
	makeSafeTimestamp,
	makeTimelineError,
	pathExists,
	sha256,
	shortHash,
} from './utils';

export class TimelineStorage {
	constructor(private readonly storageRoot: string, private readonly maxSnapshotsPerFile: number) {}

	async saveSnapshot(input: SaveSnapshotInput): Promise<TimelineSnapshotRecord | undefined> {
		const text = decodeUtf8Text(input.content);
		if (text === undefined) {
			return undefined;
		}
		const hash = sha256(input.content);
		const metadata = await this.readOrCreateMetadata(input.filePath, input.workspaceFolder);
		if (metadata.latest?.sha256 === hash) {
			return undefined;
		}

		// Clear deleted flag when saving a new snapshot (file is being restored/edited)
		delete metadata.deletedAt;
		delete metadata.deletedCommit;

		const timestamp = makeSafeTimestamp();
		const id = `${timestamp}.${shortHash(hash)}`;
		const snapshotsDir = getSnapshotsDirectory(this.storageRoot, input.filePath);
		await fs.mkdir(snapshotsDir, { recursive: true, mode: 0o700 });
		const snapshotPath = path.join(snapshotsDir, id);
		await atomicWriteFile(snapshotPath, input.content, 0o600);

		const record: TimelineSnapshotRecord = {
			id,
			path: `snapshots/${id}`,
			savedAt: new Date().toISOString(),
			reason: input.reason,
			sha256: hash,
			size: input.content.length,
			lineCount: countLines(text),
			eol: detectEol(text),
			hasTrailingNewline: hasTrailingNewline(text),
			encoding: 'utf8',
			isText: true,
			languageId: input.languageId,
			git: input.git,
		};

		metadata.updatedAt = record.savedAt;
		metadata.latest = {
			id: record.id,
			path: record.path,
			sha256: record.sha256,
			size: record.size,
			lineCount: record.lineCount,
			savedAt: record.savedAt,
		};
		metadata.records.push(record);
		delete metadata.lastGitCleanup;
		await this.writeMetadata(input.filePath, metadata);
		await this.pruneOldSnapshots(input.filePath, this.maxSnapshotsPerFile);
		return record;
	}

	async listSnapshots(filePath: string): Promise<TimelineMetadata | undefined> {
		return this.readMetadata(filePath);
	}

	async readSnapshot(filePath: string, snapshotId: string): Promise<{ record: TimelineSnapshotRecord; content: Buffer; metadata: TimelineMetadata }> {
		const metadata = await this.readMetadata(filePath);
		if (!metadata) {
			throw makeTimelineError('METADATA_NOT_FOUND', 'Timeline metadata not found.');
		}
		const record = metadata.records.find(item => item.id === snapshotId);
		if (!record) {
			throw makeTimelineError('SNAPSHOT_NOT_FOUND', 'Snapshot does not exist or has been cleaned by Git.');
		}
		const snapshotPath = this.getSnapshotPath(filePath, record.path);
		if (!(await pathExists(snapshotPath))) {
			throw makeTimelineError('SNAPSHOT_NOT_FOUND', 'Snapshot file does not exist.');
		}
		return { record, content: await fs.readFile(snapshotPath), metadata };
	}

	async cleanSnapshots(filePath: string, cleanupInfo: TimelineGitCleanupInfo, workspaceFolder?: string): Promise<void> {
		const metadata = await this.readOrCreateMetadata(filePath, workspaceFolder);
		const snapshotsDir = getSnapshotsDirectory(this.storageRoot, filePath);
		await fs.rm(snapshotsDir, { recursive: true, force: true });
		await fs.mkdir(snapshotsDir, { recursive: true, mode: 0o700 });

		// If the file has been deleted, preserve metadata (including deletedAt/deletedCommit)
		// so that restore can still work via git show fallback
		if (metadata.deletedAt) {
			metadata.latest = null;
			metadata.updatedAt = cleanupInfo.cleanedAt;
			metadata.lastGitCleanup = cleanupInfo;
			await this.writeMetadata(filePath, metadata);
			return;
		}

		metadata.latest = null;
		metadata.records = [];
		metadata.updatedAt = cleanupInfo.cleanedAt;
		metadata.lastGitCleanup = cleanupInfo;
		await this.writeMetadata(filePath, metadata);
	}

	async pruneOldSnapshots(filePath: string, maxSnapshots: number): Promise<void> {
		if (maxSnapshots <= 0) {
			return;
		}
		const metadata = await this.readMetadata(filePath);
		if (!metadata || metadata.records.length <= maxSnapshots) {
			return;
		}
		const keep = metadata.records.slice(-maxSnapshots);
		const remove = metadata.records.slice(0, -maxSnapshots);
		for (const record of remove) {
			await fs.rm(this.getSnapshotPath(filePath, record.path), { force: true });
		}
		metadata.records = keep;
		metadata.latest = keep.length > 0 ? {
			id: keep[keep.length - 1].id,
			path: keep[keep.length - 1].path,
			sha256: keep[keep.length - 1].sha256,
			size: keep[keep.length - 1].size,
			lineCount: keep[keep.length - 1].lineCount,
			savedAt: keep[keep.length - 1].savedAt,
		} : null;
		metadata.updatedAt = new Date().toISOString();
		await this.writeMetadata(filePath, metadata);
	}

	private getSnapshotPath(filePath: string, recordPath: string): string {
		if (path.isAbsolute(recordPath)) {
			throw makeTimelineError('PATH_NOT_ALLOWED', 'Snapshot record path must be relative.');
		}
		const historyDir = getHistoryDirectory(this.storageRoot, filePath);
		const snapshotPath = path.resolve(historyDir, recordPath);
		const snapshotsDir = path.resolve(historyDir, 'snapshots');
		if (!isInsidePath(snapshotPath, snapshotsDir)) {
			throw makeTimelineError('PATH_NOT_ALLOWED', 'Snapshot path escapes snapshots directory.');
		}
		return snapshotPath;
	}

	private async readMetadata(filePath: string): Promise<TimelineMetadata | undefined> {
		try {
			return JSON.parse(await fs.readFile(getMetadataPath(this.storageRoot, filePath), 'utf8')) as TimelineMetadata;
		} catch {
			return undefined;
		}
	}

	private async readOrCreateMetadata(filePath: string, workspaceFolder?: string): Promise<TimelineMetadata> {
		const existing = await this.readMetadata(filePath);
		if (existing) {
			return existing;
		}
		const now = new Date().toISOString();
		return {
			version: 1,
			sourcePath: path.resolve(filePath),
			canonicalPath: path.resolve(filePath),
			mappedPath: mapAbsolutePathToHistoryKey(filePath),
			workspaceFolder,
			createdAt: now,
			updatedAt: now,
			latest: null,
			records: [],
		};
	}

	private async writeMetadata(filePath: string, metadata: TimelineMetadata): Promise<void> {
		const metadataPath = getMetadataPath(this.storageRoot, filePath);
		await atomicWriteFile(metadataPath, JSON.stringify(metadata, null, 2), 0o600);
	}

	getMetadataPath(filePath: string): string {
		return getMetadataPath(this.storageRoot, filePath);
	}

	async markFileDeleted(filePath: string, deletedAt: string, deletedCommit: string | undefined, workspaceFolder?: string): Promise<void> {
		const metadata = await this.readOrCreateMetadata(filePath, workspaceFolder);
		metadata.deletedAt = deletedAt;
		metadata.deletedCommit = deletedCommit;
		metadata.updatedAt = deletedAt;
		// Clear the latest pointer since the source file no longer exists
		metadata.latest = null;
		await this.writeMetadata(filePath, metadata);
	}

	async clearDeletedFlag(filePath: string): Promise<void> {
		const metadata = await this.readMetadata(filePath);
		if (!metadata) {
			return;
		}
		if (metadata.records.length > 0) {
			metadata.latest = {
				id: metadata.records[metadata.records.length - 1].id,
				path: metadata.records[metadata.records.length - 1].path,
				sha256: metadata.records[metadata.records.length - 1].sha256,
				size: metadata.records[metadata.records.length - 1].size,
				lineCount: metadata.records[metadata.records.length - 1].lineCount,
				savedAt: metadata.records[metadata.records.length - 1].savedAt,
			};
		}
		delete metadata.deletedAt;
		delete metadata.deletedCommit;
		metadata.updatedAt = new Date().toISOString();
		await this.writeMetadata(filePath, metadata);
	}
}
