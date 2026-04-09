#!/usr/bin/env bun

import pc from "picocolors";
import { getUsageLimits } from "../index";

const pico = pc.createColors(true);

const WEEKLY_HOURS = 168;
const FIVE_HOUR_MINUTES = 300;

function formatResetTime(resetsAt: string): string {
	const resetDate = new Date(resetsAt);
	const now = new Date();
	const diffMs = resetDate.getTime() - now.getTime();

	if (diffMs <= 0) return "now";

	const hours = Math.floor(diffMs / 3600000);
	const minutes = Math.floor((diffMs % 3600000) / 60000);

	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

function pacingDelta(
	utilization: number,
	resetsAt: string,
	totalMinutes: number,
): number {
	const resetDate = new Date(resetsAt);
	const now = new Date();
	const diffMs = resetDate.getTime() - now.getTime();
	const minutesRemaining = Math.max(0, diffMs / 60000);
	const timeElapsedPercent =
		((totalMinutes - minutesRemaining) / totalMinutes) * 100;
	return utilization - timeElapsedPercent;
}

function formatDelta(delta: number): string {
	const sign = delta >= 0 ? "+" : "";
	const value = `${sign}${delta.toFixed(1)}%`;

	if (delta > 5) return pico.red(value);
	if (delta > 0) return pico.yellow(value);
	if (delta > -10) return pico.green(value);
	return pico.green(value);
}

function progressBar(utilization: number, width = 30): string {
	const filled = Math.round((utilization / 100) * width);
	const empty = width - filled;

	let color: (s: string) => string;
	if (utilization < 50) color = pico.green;
	else if (utilization < 70) color = pico.yellow;
	else if (utilization < 90) color = (s: string) => `\x1b[38;5;208m${s}\x1b[0m`;
	else color = pico.red;

	return `${color("█".repeat(filled))}${pico.gray("░".repeat(empty))}`;
}

async function main() {
	console.log(pico.bold("\nClaude Code Usage Analysis\n"));

	const limits = await getUsageLimits();

	if (!limits.five_hour && !limits.seven_day) {
		console.log(
			pico.red("Could not fetch usage data. Check your OAuth token.\n"),
		);
		return;
	}

	// Five-hour window
	if (limits.five_hour) {
		const fh = limits.five_hour;
		console.log(pico.bold("5-Hour Window"));
		console.log(`  ${progressBar(fh.utilization)} ${fh.utilization}%`);

		if (fh.resets_at) {
			const delta = pacingDelta(
				fh.utilization,
				fh.resets_at,
				FIVE_HOUR_MINUTES,
			);
			console.log(`  Resets in: ${pico.cyan(formatResetTime(fh.resets_at))}`);
			console.log(`  Pacing:   ${formatDelta(delta)}`);

			if (delta > 10) {
				console.log(pico.red("  ⚠ Above pace — consider slowing down"));
			} else if (delta < -20) {
				console.log(pico.green("  ✓ Well below pace — plenty of headroom"));
			}
		}
		console.log("");
	}

	// Seven-day window
	if (limits.seven_day) {
		const sd = limits.seven_day;
		console.log(pico.bold("7-Day Window"));
		console.log(`  ${progressBar(sd.utilization)} ${sd.utilization}%`);

		if (sd.resets_at) {
			const delta = pacingDelta(
				sd.utilization,
				sd.resets_at,
				WEEKLY_HOURS * 60,
			);
			console.log(`  Resets in: ${pico.cyan(formatResetTime(sd.resets_at))}`);
			console.log(`  Pacing:   ${formatDelta(delta)}`);

			const resetDate = new Date(sd.resets_at);
			const now = new Date();
			const hoursRemaining = Math.max(
				0,
				(resetDate.getTime() - now.getTime()) / 3600000,
			);
			const remainingPct = 100 - sd.utilization;
			const budgetPerHour =
				hoursRemaining > 0 ? remainingPct / hoursRemaining : 0;

			console.log(
				`  Budget:   ${pico.gray(`~${budgetPerHour.toFixed(1)}%/hour remaining`)}`,
			);
		}
		console.log("");
	}

	console.log(pico.gray("Data from api.anthropic.com/api/oauth/usage\n"));
}

main();
