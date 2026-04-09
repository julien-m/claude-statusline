/**
 * Pure statusline renderer - no I/O, no side effects
 *
 * ARCHITECTURE: Raw data in, formatted string out.
 */

import {
	colors,
	formatCost,
	formatDuration,
	formatPath,
	formatProgressBar,
	formatResetTime,
	formatTokens,
} from "./formatters";

// ─────────────────────────────────────────────────────────────
// DISPLAY CONFIGURATION (hardcoded)
// ─────────────────────────────────────────────────────────────

const SEP = "·";
const PATH_MODE = "truncated" as const;
const COST_FORMAT = "decimal1" as const;
const MAX_CONTEXT_TOKENS = 200000;

const TOKEN_PRICES = {
	input: 3,
	output: 15,
	cacheWrite: 3.75,
	cacheRead: 0.30,
} as const;

const WEEKLY_HOURS = 168; // 7 days * 24 hours
const FIVE_HOUR_MINUTES = 300; // 5 hours * 60 minutes

// ─────────────────────────────────────────────────────────────
// RAW DATA TYPES - No pre-formatting, just raw values
// ─────────────────────────────────────────────────────────────

export interface GitChanges {
	files: number;
	added: number;
	deleted: number;
}

export interface RawGitData {
	branch: string;
	dirty: boolean;
	staged: GitChanges;
	unstaged: GitChanges;
}

export interface UsageLimit {
	utilization: number;
	resets_at: string | null;
}

export interface TokenBreakdownData {
	inputTokens: number;
	outputTokens: number;
	cacheCreationTokens: number;
	cacheReadTokens: number;
	blockCost: number;
	blockRemainingMin: number;
	blockProjectionCost: number;
	burnRatePerHour: number;
	totalCost: number;
}

export interface RawStatuslineData {
	git: RawGitData | null;
	path: string;
	modelName: string;
	contextWindowSize?: number;
	cost: number;
	durationMs: number;
	contextTokens: number | null;
	contextPercentage: number | null;
	usageLimits?: {
		five_hour: UsageLimit | null;
		seven_day: UsageLimit | null;
	};
	periodCost?: number;
	todayCost?: number;
	weekCost?: number;
	tokenBreakdown?: TokenBreakdownData | null;
}

// Legacy interface for backwards compatibility
export interface StatuslineData {
	branch: string;
	dirPath: string;
	modelName: string;
	contextWindowSize?: number;
	sessionCost: string;
	sessionDuration: string;
	contextTokens: number | null;
	contextPercentage: number | null;
	usageLimits?: {
		five_hour: UsageLimit | null;
		seven_day: UsageLimit | null;
	};
	periodCost?: number;
	todayCost?: number;
	weekCost?: number;
	tokenBreakdown?: TokenBreakdownData | null;
}

// ─────────────────────────────────────────────────────────────
// FORMATTING
// ─────────────────────────────────────────────────────────────

function formatContextWindowSize(tokens: number): string {
	if (tokens >= 1000000) {
		const value = tokens / 1000000;
		return value % 1 === 0 ? `${value}M` : `${value.toFixed(1)}M`;
	}
	if (tokens >= 1000) {
		const value = tokens / 1000;
		return value % 1 === 0 ? `${value}K` : `${value.toFixed(1)}K`;
	}
	return tokens.toString();
}

function formatGitPart(git: RawGitData | null): string {
	if (!git) return "";

	const parts: string[] = [colors.lightGray(git.branch)];

	if (git.dirty) {
		parts[0] += colors.purple("*");
	}

	const changeParts: string[] = [];
	const totalAdded = git.staged.added + git.unstaged.added;
	const totalDeleted = git.staged.deleted + git.unstaged.deleted;
	if (totalAdded > 0) changeParts.push(colors.green(`+${totalAdded}`));
	if (totalDeleted > 0) changeParts.push(colors.red(`-${totalDeleted}`));
	if (git.staged.files > 0) changeParts.push(colors.gray(`~${git.staged.files}`));
	if (git.unstaged.files > 0) changeParts.push(colors.yellow(`~${git.unstaged.files}`));

	if (changeParts.length > 0) parts.push(changeParts.join(" "));

	return parts.join(" ");
}

function formatSessionPart(
	cost: number,
	durationMs: number,
	contextTokens: number | null,
	contextPercentage: number | null,
): string {
	if (contextTokens === null || contextPercentage === null) {
		return `${colors.gray("S:")} ${colors.gray("-")}`;
	}

	const items: string[] = [];

	items.push(`${colors.gray("$")}${colors.dimWhite(formatCost(cost, COST_FORMAT))}`);
	items.push(formatTokens(contextTokens, false));

	const bar = formatProgressBar({
		percentage: contextPercentage,
		length: 10,
		style: "braille",
		colorMode: "progressive",
		background: "none",
	});
	items.push(`${bar} ${colors.lightGray(contextPercentage.toString())}${colors.gray("%")}`);

	items.push(colors.gray(`(${formatDuration(durationMs)})`));

	return `${colors.gray("S:")} ${items.join(" ")}`;
}

function colorForUsagePct(pct: number): (text: string | number) => string {
	if (pct < 45) return colors.green;
	if (pct < 60) return colors.yellow;
	if (pct < 80) return colors.orange;
	return colors.red;
}

function formatLimitsPart(
	fiveHour: UsageLimit | null,
	periodCost: number,
): string {
	if (!fiveHour) return "";

	const parts: string[] = [];

	if (periodCost > 0) {
		parts.push(
			`${colors.gray("$")}${colors.dimWhite(formatCost(periodCost, COST_FORMAT))}`,
		);
	}

	const pctColor = colorForUsagePct(fiveHour.utilization);
	parts.push(`${pctColor(fiveHour.utilization.toString())}${colors.gray("%")}`);

	if (fiveHour.resets_at) {
		parts.push(colors.gray(`(${formatResetTime(fiveHour.resets_at)})`));
	}

	return parts.length > 0 ? `${colors.gray("5h")} ${parts.join(" ")}` : "";
}

function calculateWeeklyDelta(
	utilization: number,
	resetsAt: string | null,
): number {
	if (!resetsAt) return 0;
	const resetDate = new Date(resetsAt);
	const now = new Date();
	const diffMs = resetDate.getTime() - now.getTime();
	const hoursRemaining = Math.max(0, diffMs / 3600000);
	const timeElapsedPercent =
		((WEEKLY_HOURS - hoursRemaining) / WEEKLY_HOURS) * 100;
	return utilization - timeElapsedPercent;
}

function formatPacingDelta(delta: number): string {
	const sign = delta >= 0 ? "+" : "";
	const value = `${sign}${delta.toFixed(1)}%`;

	if (delta > 5) return colors.green(value);
	if (delta > 0) return colors.lightGray(value);
	if (delta > -10) return colors.yellow(value);
	return colors.red(value);
}

function formatWeeklyPart(
	sevenDay: UsageLimit | null,
	weekCost: number,
): string {
	if (!sevenDay) return "";

	const parts: string[] = [];

	if (weekCost > 0) {
		parts.push(
			`${colors.gray("$")}${colors.dimWhite(formatCost(weekCost, COST_FORMAT))}`,
		);
	}

	const pctColor = colorForUsagePct(sevenDay.utilization);
	parts.push(`${pctColor(sevenDay.utilization.toString())}${colors.gray("%")}`);

	if (sevenDay.resets_at) {
		const delta = calculateWeeklyDelta(sevenDay.utilization, sevenDay.resets_at);
		parts.push(
			`${colors.gray("(")}${formatPacingDelta(delta)}${colors.gray(")")}`,
		);

		parts.push(colors.gray(`(${formatResetTime(sevenDay.resets_at)})`));
	}

	return parts.length > 0 ? `${colors.gray("7d")} ${parts.join(" ")}` : "";
}

function formatDailyPart(todayCost: number): string {
	if (todayCost <= 0) return "";
	return `${colors.gray("D:")} ${colors.gray("$")}${colors.dimWhite(formatCost(todayCost, COST_FORMAT))}`;
}

function tokenCostPct(tokens: number, pricePerMTok: number, totalCost: number): number {
	if (totalCost <= 0) return 0;
	return Math.round(((tokens * pricePerMTok) / 1_000_000 / totalCost) * 100);
}

function formatTokenBreakdownPart(
	data: TokenBreakdownData | null | undefined,
): string {
	if (!data || data.totalCost <= 0) return "";

	const inPct = tokenCostPct(data.inputTokens, TOKEN_PRICES.input, data.totalCost);
	const outPct = tokenCostPct(data.outputTokens, TOKEN_PRICES.output, data.totalCost);
	const cwPct = tokenCostPct(data.cacheCreationTokens, TOKEN_PRICES.cacheWrite, data.totalCost);
	const crPct = tokenCostPct(data.cacheReadTokens, TOKEN_PRICES.cacheRead, data.totalCost);

	const breakdownStr = `in:${inPct}% out:${outPct}% cw:${cwPct}% cr:${crPct}%`;
	const parts = [breakdownStr];

	if (data.burnRatePerHour > 0) {
		parts.push(`🔥 $${data.burnRatePerHour.toFixed(1)}/h → $${data.blockProjectionCost.toFixed(0)}`);
	}

	return `${colors.gray("T:")} ${parts.join(` ${colors.gray("·")} `)}`;
}

// ─────────────────────────────────────────────────────────────
// MAIN RENDER FUNCTION
// ─────────────────────────────────────────────────────────────

export function renderStatuslineRaw(data: RawStatuslineData): string {
	const sep = colors.gray(SEP);
	const sections: string[] = [];

	// Line 1: Git + Path + Model
	const line1Parts: string[] = [];

	const gitPart = formatGitPart(data.git);
	if (gitPart) line1Parts.push(gitPart);

	line1Parts.push(colors.gray(formatPath(data.path, PATH_MODE)));

	const isSonnet = data.modelName.toLowerCase().includes("sonnet");
	void isSonnet; // kept for potential future model-based filtering
	let modelDisplay = colors.peach(data.modelName);
	if (data.contextWindowSize) {
		modelDisplay += ` ${colors.gray(`(${formatContextWindowSize(data.contextWindowSize)} context)`)}`;
	}
	line1Parts.push(modelDisplay);

	sections.push(line1Parts.join(` ${sep} `));

	// Line 2: Session info
	const sessionPart = formatSessionPart(
		data.cost,
		data.durationMs,
		data.contextTokens,
		data.contextPercentage,
	);
	if (sessionPart) sections.push(sessionPart);

	// 5h limit
	const limitsPart = formatLimitsPart(
		data.usageLimits?.five_hour ?? null,
		data.periodCost ?? 0,
	);
	if (limitsPart) sections.push(limitsPart);

	// 7d weekly
	const weeklyPart = formatWeeklyPart(
		data.usageLimits?.seven_day ?? null,
		data.weekCost ?? 0,
	);
	if (weeklyPart) sections.push(weeklyPart);

	// Daily
	const dailyPart = formatDailyPart(data.todayCost ?? 0);
	if (dailyPart) sections.push(dailyPart);

	// Token breakdown
	const tokenBreakdownPart = formatTokenBreakdownPart(data.tokenBreakdown);
	if (tokenBreakdownPart) sections.push(tokenBreakdownPart);

	// Two-line mode: break after line1
	const line1 = sections[0];
	const rest = sections.slice(1).join(` ${sep} `);
	return rest ? `${line1}\n${rest}` : line1;
}

// ─────────────────────────────────────────────────────────────
// LEGACY SUPPORT - For backwards compatibility with old data format
// ─────────────────────────────────────────────────────────────

export function renderStatusline(data: StatuslineData): string {
	const rawData: RawStatuslineData = {
		git: parseGitFromBranch(data.branch),
		path: data.dirPath,
		modelName: data.modelName,
		contextWindowSize: data.contextWindowSize,
		cost: parseFloat(data.sessionCost.replace(/[$,]/g, "")) || 0,
		durationMs: parseDurationToMs(data.sessionDuration),
		contextTokens: data.contextTokens,
		contextPercentage: data.contextPercentage,
		usageLimits: data.usageLimits,
		periodCost: data.periodCost,
		todayCost: data.todayCost,
		weekCost: data.weekCost,
		tokenBreakdown: data.tokenBreakdown,
	};

	return renderStatuslineRaw(rawData);
}

function parseGitFromBranch(branch: string): RawGitData | null {
	if (!branch) return null;

	const dirty = branch.includes("*");
	const branchName =
		branch.replace(/\*.*$/, "").replace(/\*/, "").trim() || "main";

	const addMatch = branch.match(/\+(\d+)/);
	const delMatch = branch.match(/-(\d+)/);
	const added = addMatch ? parseInt(addMatch[1], 10) : 0;
	const deleted = delMatch ? parseInt(delMatch[1], 10) : 0;

	return {
		branch: branchName,
		dirty,
		staged: {
			files: 0,
			added: Math.floor(added / 2),
			deleted: Math.floor(deleted / 2),
		},
		unstaged: {
			files: 0,
			added: Math.ceil(added / 2),
			deleted: Math.ceil(deleted / 2),
		},
	};
}

function parseDurationToMs(duration: string): number {
	let ms = 0;
	const hourMatch = duration.match(/(\d+)h/);
	const minMatch = duration.match(/(\d+)m/);
	if (hourMatch) ms += parseInt(hourMatch[1], 10) * 3600000;
	if (minMatch) ms += parseInt(minMatch[1], 10) * 60000;
	return ms || 720000;
}
