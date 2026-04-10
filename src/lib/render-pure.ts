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
	cacheRead: 0.3,
} as const;

const WEEKLY_HOURS = 168; // 7 days * 24 hours

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
	if (git.staged.files > 0)
		changeParts.push(colors.gray(`~${git.staged.files}`));
	if (git.unstaged.files > 0)
		changeParts.push(colors.yellow(`~${git.unstaged.files}`));

	if (changeParts.length > 0) parts.push(changeParts.join(" "));

	return parts.join(" ");
}

function formatNumeric(value: number): string {
	return parseFloat(value.toFixed(2)).toString();
}

function colorForUsagePct(pct: number): (text: string | number) => string {
	if (pct < 45) return colors.green;
	if (pct < 60) return colors.yellow;
	if (pct < 80) return colors.orange;
	return colors.red;
}

function group(content: string): string {
	return `${colors.gray("[")}${content}${colors.gray("]")}`;
}

// Group 1: Context — [82% ██████░░░░ 164K]
function formatContextGroup(
	contextTokens: number | null,
	contextPercentage: number | null,
): string {
	if (contextTokens === null || contextPercentage === null) return "";

	const bar = formatProgressBar({
		percentage: contextPercentage,
		length: 10,
		style: "braille",
		colorMode: "progressive",
		background: "none",
	});
	const pct = `${colors.lightGray(contextPercentage.toString())}${colors.gray("%")}`;
	const tok = formatTokens(contextTokens, false);

	return group(`${pct} ${bar} ${tok}`);
}

// Group 2: Money — [D $57.8 · W $2038 · 🔥 $12.4/h]
function formatMoneyGroup(
	todayCost: number,
	weekCost: number,
	tokenBreakdown: TokenBreakdownData | null | undefined,
): string {
	const parts: string[] = [];

	parts.push(
		`${colors.gray("D")} ${colors.gray("$")}${colors.dimWhite(formatCost(todayCost, COST_FORMAT))}`,
	);
	if (weekCost > 0) {
		parts.push(
			`${colors.gray("W")} ${colors.gray("$")}${colors.dimWhite(formatCost(weekCost, COST_FORMAT))}`,
		);
	}
	if (tokenBreakdown && tokenBreakdown.burnRatePerHour > 0) {
		parts.push(
			`🔥 ${colors.gray("$")}${tokenBreakdown.burnRatePerHour.toFixed(1)}${colors.gray("/h")}`,
		);
	}

	return parts.length > 0 ? group(parts.join(` ${colors.gray("·")} `)) : "";
}

// Group 3: Session — [S $7.9 · 2h36m]
function formatSessionGroup(cost: number, durationMs: number): string {
	const costStr = `${colors.gray("S")} ${colors.gray("$")}${colors.dimWhite(formatCost(cost, COST_FORMAT))}`;
	const dur = colors.gray(formatDuration(durationMs));
	return group(`${costStr} ${colors.gray("·")} ${dur}`);
}

// Group 4: Quotas — [5h 45% 1h50m · 7d 65%]
function formatQuotasGroup(
	fiveHour: UsageLimit | null,
	sevenDay: UsageLimit | null,
): string {
	const parts: string[] = [];

	if (fiveHour) {
		const pctColor = colorForUsagePct(fiveHour.utilization);
		let seg = `${colors.gray("5h")} ${pctColor(formatNumeric(fiveHour.utilization))}${colors.gray("%")}`;
		if (fiveHour.resets_at) {
			seg += ` ${colors.gray(formatResetTime(fiveHour.resets_at))}`;
		}
		parts.push(seg);
	}

	if (sevenDay) {
		const pctColor = colorForUsagePct(sevenDay.utilization);
		parts.push(
			`${colors.gray("7d")} ${pctColor(formatNumeric(sevenDay.utilization))}${colors.gray("%")}`,
		);
	}

	return parts.length > 0 ? group(parts.join(` ${colors.gray("·")} `)) : "";
}

// Group 5: Token breakdown — [in:1% out:6% cw:51% cr:58%]
function tokenCostPct(
	tokens: number,
	pricePerMTok: number,
	totalCost: number,
): number {
	if (totalCost <= 0) return 0;
	return Math.round(((tokens * pricePerMTok) / 1_000_000 / totalCost) * 100);
}

function formatTokensGroup(
	data: TokenBreakdownData | null | undefined,
): string {
	if (!data || data.totalCost <= 0) return "";

	const inPct = tokenCostPct(data.inputTokens, TOKEN_PRICES.input, data.totalCost);
	const outPct = tokenCostPct(data.outputTokens, TOKEN_PRICES.output, data.totalCost);
	const cwPct = tokenCostPct(data.cacheCreationTokens, TOKEN_PRICES.cacheWrite, data.totalCost);
	const crPct = tokenCostPct(data.cacheReadTokens, TOKEN_PRICES.cacheRead, data.totalCost);

	const content = [
		`${colors.blue("in")}${colors.gray(":")}${inPct}${colors.gray("%")}`,
		`${colors.green("out")}${colors.gray(":")}${outPct}${colors.gray("%")}`,
		`${colors.orange("cw")}${colors.gray(":")}${cwPct}${colors.gray("%")}`,
		`${colors.cyan("cr")}${colors.gray(":")}${crPct}${colors.gray("%")}`,
	].join(" ");

	return group(content);
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

	// Line 2: 5 groups in brackets
	const contextGroup = formatContextGroup(data.contextTokens, data.contextPercentage);
	if (contextGroup) sections.push(contextGroup);

	const moneyGroup = formatMoneyGroup(
		data.todayCost ?? 0,
		data.weekCost ?? 0,
		data.tokenBreakdown,
	);
	if (moneyGroup) sections.push(moneyGroup);

	const sessionGroup = formatSessionGroup(data.cost, data.durationMs);
	if (sessionGroup) sections.push(sessionGroup);

	const quotasGroup = formatQuotasGroup(
		data.usageLimits?.five_hour ?? null,
		data.usageLimits?.seven_day ?? null,
	);
	if (quotasGroup) sections.push(quotasGroup);

	const tokensGroup = formatTokensGroup(data.tokenBreakdown);
	if (tokensGroup) sections.push(tokensGroup);

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
