#!/usr/bin/env bun

// This script runs as a standalone process — never imported by index.ts
import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { upsertSessionTokenBreakdown } from "../index";

interface CcusageSessionEntry {
	inputTokens: number;
	outputTokens: number;
	cacheCreationTokens: number;
	cacheReadTokens: number;
}

interface CcusageSessionResponse {
	sessionId: string;
	totalCost: number;
	entries: CcusageSessionEntry[];
}

function isCcusageSessionResponse(
	data: unknown,
): data is CcusageSessionResponse {
	return (
		typeof data === "object" &&
		data !== null &&
		"sessionId" in data &&
		"totalCost" in data &&
		"entries" in data &&
		Array.isArray((data as CcusageSessionResponse).entries)
	);
}

type SpawnedProcess = ReturnType<typeof Bun.spawn>;
const activeChildren: SpawnedProcess[] = [];

function cleanupChildren() {
	for (const child of activeChildren) {
		try {
			child.kill();
		} catch {}
	}
	activeChildren.length = 0;
}

process.on("SIGTERM", () => {
	cleanupChildren();
	process.exit(143);
});
process.on("SIGINT", () => {
	cleanupChildren();
	process.exit(130);
});

async function runCcusage(args: string[]): Promise<unknown> {
	const proc = Bun.spawn(
		["/opt/homebrew/bin/bun", "/opt/homebrew/bin/ccusage", ...args],
		{
			stdout: "pipe",
		},
	);
	activeChildren.push(proc);

	try {
		const text = await new Response(proc.stdout).text();
		const exitCode = await proc.exited;

		if (exitCode !== 0) {
			throw new Error(`ccusage exited with code ${exitCode}`);
		}

		return JSON.parse(text);
	} finally {
		const idx = activeChildren.indexOf(proc);
		if (idx >= 0) activeChildren.splice(idx, 1);
		try {
			proc.kill();
		} catch {}
	}
}

async function findActiveSessionFiles(): Promise<string[]> {
	const claudeProjectsDir = join(
		process.env.HOME ?? "~",
		".claude",
		"projects",
	);
	const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
	const activeFiles: string[] = [];

	let projectDirs: string[];
	try {
		projectDirs = await readdir(claudeProjectsDir);
	} catch {
		return [];
	}

	for (const projectDir of projectDirs) {
		const projectPath = join(claudeProjectsDir, projectDir);
		let files: string[];
		try {
			files = await readdir(projectPath);
		} catch {
			continue;
		}
		for (const file of files) {
			if (!file.endsWith(".jsonl")) continue;
			const filePath = join(projectPath, file);
			try {
				const s = await stat(filePath);
				if (s.mtimeMs >= fiveMinutesAgo) {
					activeFiles.push(filePath);
				}
			} catch {
				// skip
			}
		}
	}

	return activeFiles;
}

async function syncSession(filePath: string): Promise<void> {
	const sessionId = basename(filePath, ".jsonl");
	const raw = await runCcusage(["session", "-i", sessionId, "--json"]);
	if (raw === null) return; // session not yet indexed by ccusage
	if (!isCcusageSessionResponse(raw)) {
		throw new Error(`Unexpected ccusage session response for ${sessionId}`);
	}
	const entries = raw.entries;
	upsertSessionTokenBreakdown({
		sessionId,
		inputTokens: entries.reduce((s, e) => s + (e.inputTokens ?? 0), 0),
		outputTokens: entries.reduce((s, e) => s + (e.outputTokens ?? 0), 0),
		cacheCreationTokens: entries.reduce(
			(s, e) => s + (e.cacheCreationTokens ?? 0),
			0,
		),
		cacheReadTokens: entries.reduce((s, e) => s + (e.cacheReadTokens ?? 0), 0),
		totalCost: raw.totalCost,
	});
}

async function main(): Promise<void> {
	const activeFiles = await findActiveSessionFiles();
	for (const filePath of activeFiles) {
		try {
			await syncSession(filePath);
		} catch (err) {
			process.stderr.write(`sync-session-tokens: ${filePath}: ${err}\n`);
		}
	}

	// Cleanup rows older than 24 hours
	try {
		const { getDb } = await import("../index");
		getDb().run(
			"DELETE FROM session_token_breakdown WHERE updated_at < datetime('now', '-24 hours')",
		);
	} catch {
		// Fail silently
	}
}

main().catch((err) => {
	process.stderr.write(`sync-session-tokens error: ${err}\n`);
	process.exit(1);
});
