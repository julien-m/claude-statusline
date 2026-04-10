#!/usr/bin/env bun

/**
 * Backfill daily_tokens from ccusage for a date range.
 * Usage: bun backfill-daily-tokens.ts [since] [until]
 * Example: bun backfill-daily-tokens.ts 20260401 20260410
 * Defaults: since = first day of current month, until = today
 */

import { upsertDailyTokens } from "../index";

interface CcusageDailyEntry {
	date: string; // YYYY-MM-DD
	inputTokens: number;
	outputTokens: number;
	cacheCreationTokens: number;
	cacheReadTokens: number;
	totalCost: number;
}

interface CcusageDailyRangeResponse {
	daily: CcusageDailyEntry[];
}

function toYYYYMMDD(date: Date): string {
	return date.toISOString().slice(0, 10).replace(/-/g, "");
}

async function main(): Promise<void> {
	const today = new Date();
	const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

	const since = process.argv[2] ?? toYYYYMMDD(firstOfMonth);
	const until = process.argv[3] ?? toYYYYMMDD(today);

	console.log(`Backfilling daily_tokens from ${since} to ${until}...`);

	const proc = Bun.spawn(
		["/opt/homebrew/bin/bun", "/opt/homebrew/bin/ccusage", "daily", "--since", since, "--until", until, "--json", "--offline"],
		{ stdout: "pipe" },
	);

	const text = await new Response(proc.stdout).text();
	const exitCode = await proc.exited;

	if (exitCode !== 0) {
		throw new Error(`ccusage exited with code ${exitCode}`);
	}

	const data = JSON.parse(text) as CcusageDailyRangeResponse;

	if (!Array.isArray(data.daily)) {
		throw new Error("Unexpected ccusage response: missing daily array");
	}

	let count = 0;
	for (const entry of data.daily) {
		upsertDailyTokens({
			date: entry.date,
			inputTokens: entry.inputTokens,
			outputTokens: entry.outputTokens,
			cacheCreationTokens: entry.cacheCreationTokens,
			cacheReadTokens: entry.cacheReadTokens,
			blockCost: 0,
			blockRemainingMin: 0,
			blockProjectionCost: 0,
			burnRatePerHour: 0,
			totalCost: entry.totalCost,
			updatedAt: new Date().toISOString(),
		});
		console.log(`  ✓ ${entry.date} — $${entry.totalCost.toFixed(2)}`);
		count++;
	}

	console.log(`Done. ${count} days upserted.`);
}

main().catch((err) => {
	process.stderr.write(`backfill error: ${err}\n`);
	process.exit(1);
});
