import * as vscode from 'vscode';

export interface TimelineGitRecord {
	repoRoot?: string;
	head?: string;
	isTracked?: boolean;
	status?: string;
}

export interface TimelineSnapshotRecord {
	id: string;
	path: string;
	savedAt: string;
	reason: TimelineSaveReason;
	sha256: string;
	size: number;
	lineCount: number;
	eol: TimelineEol;
	hasTrailingNewline: boolean;
	encoding: 'utf8';
	isText: true;
	languageId?: string;
	git?: TimelineGitRecord;
}

export interface TimelineLatestRecord {
	id: string;
	path: string;
	sha256: string;
	size: number;
	lineCount: number;
	savedAt: string;
}

export interface TimelineGitCleanupInfo {
	cleanedAt: string;
	repoRoot?: string;
	commit?: string;
	reason: 'gitCommit' | 'saveClean' | 'manual';
	changedPath?: string;
}

export interface TimelineMetadata {
	version: 1;
	sourcePath: string;
	canonicalPath: string;
	mappedPath: string;
	workspaceFolder?: string;
	createdAt: string;
	updatedAt: string;
	latest: TimelineLatestRecord | null;
	records: TimelineSnapshotRecord[];
	lastGitCleanup?: TimelineGitCleanupInfo;
	deletedAt?: string;
	deletedCommit?: string;
}

export type TimelineSaveReason = 'onDidSaveTextDocument' | 'onDidOpenTextDocument' | 'beforeRestore' | 'manual' | 'deleted';
export type TimelineEol = 'lf' | 'crlf' | 'cr' | 'mixed' | 'none';

export interface SaveSnapshotInput {
	filePath: string;
	content: Buffer;
	reason: TimelineSaveReason;
	languageId?: string;
	workspaceFolder?: string;
	git?: TimelineGitRecord;
}

export interface TimelineListResult {
	ok: true;
	filePath: string;
	sourceExists: boolean;
	metadataExists: boolean;
	metadataPath: string;
	latest: TimelineLatestRecord | null;
	records: TimelineSnapshotRecord[];
	recordCount: number;
	restorable: boolean;
	lastGitCleanup: TimelineGitCleanupInfo | null;
	isDeleted: boolean;
	deletedAt?: string;
	deletedCommit?: string;
}

export interface TimelineRestoreResult {
	ok: true;
	restored: true;
	filePath: string;
	snapshotId: string;
	sha256: string;
	bytesWritten: number;
	lineCount: number;
	createdPreRestoreSnapshot: boolean;
}

export interface TimelineReadLinesResult {
	ok: true;
	filePath: string;
	snapshotId: string;
	startLine: number;
	endLine: number;
	requestedLineCount: number;
	returnedLineCount: number;
	totalLines: number;
	truncated: boolean;
	content: string;
}

export interface TimelineToolErrorResult {
	ok: false;
	error: {
		code: TimelineToolErrorCode;
		message: string;
		retryable: boolean;
	};
}

export type TimelineToolResult = TimelineListResult | TimelineRestoreResult | TimelineReadLinesResult | TimelineToolErrorResult;

export type TimelineToolErrorCode =
	| 'INVALID_ARGUMENT'
	| 'PATH_NOT_ALLOWED'
	| 'FILE_NOT_IN_WORKSPACE'
	| 'METADATA_NOT_FOUND'
	| 'SNAPSHOT_NOT_FOUND'
	| 'SNAPSHOT_CLEANED_BY_GIT'
	| 'GIT_PROTECTED_CLEAN_FILE'
	| 'FILE_DELETED'
	| 'RANGE_OUT_OF_BOUNDS'
	| 'TOO_MANY_LINES'
	| 'TOO_MANY_INTERNAL_TOOL_ROUNDS'
	| 'INTERNAL_ERROR';

export interface GitDirectories {
	gitDir: string;
	commonGitDir: string;
}

export interface ChangedPath {
	status: string;
	path: string;
	oldPath?: string;
}

export interface TimelinePolicy {
	enabled: true;
	storageRoot: string;
	maxFileSizeMB: number;
	maxSnapshotsPerFile: number;
	cleanWhenCommitted: true;
	excludeGlobs: readonly string[];
	maxReadLines: number;
}

export interface TimelineServiceLike {
	register(): vscode.Disposable;
	listSnapshotsByFile(filePath: string): Promise<TimelineListResult>;
	restoreSnapshotById(filePath: string, snapshotId: string, expectedSha256?: string): Promise<TimelineRestoreResult>;
	readSnapshotLines(filePath: string, snapshotId: string, startLine: number, lineCount: number): Promise<TimelineReadLinesResult>;
}
