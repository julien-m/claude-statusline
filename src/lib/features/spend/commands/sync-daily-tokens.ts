#!/usr/bin/env bun

import { upsertDailyTokens } from "../index";

interface CcusageDailyResponse {
	totals: {
		inputTokens: number;
		outputTokens: number;
		cacheCreationTokens: number;
		cacheReadTokens: number;
		totalCost: number;
	};
}

interface CcusageBlock {
	isActive: boolean;
	costUSD: number;
	burnRate: {
		costPerHour: number;
	} | null;
	projection: {
		remainingMinutes: number;
		totalCost: number;
	} | null;
}

interface CcusageBlocksResponse {
	blocks: CcusageBlock[];
}

function isCcusageDailyResponse(data: unknown): data is CcusageDailyResponse {
	return (
		typeof data === "object" &&
		data !== null &&
		"totals" in data &&
		typeof (data as CcusageDailyResponse).totals === "object"
	);
}

function isCcusageBlocksResponse(data: unknown): data is CcusageBlocksResponse {
	return (
		typeof data === "object" &&
		data !== null &&
		"blocks" in data &&
		Array.isArray((data as CcusageBlocksResponse).blocks)
	);
}

async function runCcusage(args: string[]): Promise<unknown> {
	const proc = Bun.spawn(["ccusage", ...args], {
		stdout: "pipe",
	});

	const text = await new Response(proc.stdout).text();
	const exitCode = await proc.exited;

	if (exitCode !== 0) {
		throw new Error(`ccusage exited with code ${exitCode}`);
	}

	return JSON.parse(text);
}

async function main(): Promise<void> {
	// Compute today and yesterday in UTC, YYYYMMDD format for ccusage
	const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
	const yesterday = new Date(Date.now() - 24 * 3600 * 1000)
		.toISOString()
		.slice(0, 10)
		.replace(/-/g, "");

	// Fetch daily tokens for today
	const dailyRaw = await runCcusage(["daily", "--since", today, "--until", today, "--json", "--offline"]);
	if (!isCcusageDailyResponse(dailyRaw)) {
		throw new Error("Unexpected ccusage daily response format");
	}
	const dailyResponse: CcusageDailyResponse = dailyRaw;

	// Fetch blocks since yesterday to catch cross-midnight active blocks
	const blocksRaw = await runCcusage(["blocks", "--since", yesterday, "--json", "--offline"]);
	if (!isCcusageBlocksResponse(blocksRaw)) {
		throw new Error("Unexpected ccusage blocks response format");
	}
	const blocksResponse: CcusageBlocksResponse = blocksRaw;

	// Find first active block
	const activeBlock = blocksResponse.blocks.find((b) => b.isActive);

	// Build the row with all fields
	const dateStr = today.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
	const row = {
		date: dateStr,
		inputTokens: dailyResponse.totals.inputTokens,
		outputTokens: dailyResponse.totals.outputTokens,
		cacheCreationTokens: dailyResponse.totals.cacheCreationTokens,
		cacheReadTokens: dailyResponse.totals.cacheReadTokens,
		blockCost: activeBlock?.costUSD ?? 0,
		blockRemainingMin: Math.floor(activeBlock?.projection?.remainingMinutes ?? 0),
		blockProjectionCost: activeBlock?.projection?.totalCost ?? 0,
		burnRatePerHour: activeBlock?.burnRate?.costPerHour ?? 0,
		totalCost: dailyResponse.totals.totalCost,
		updatedAt: new Date().toISOString(),
	};

	upsertDailyTokens(row);
}

main().catch(() => process.exit(0));
