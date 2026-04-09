#!/usr/bin/env bun

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getContextData } from "./lib/context";
import { colors, formatPath } from "./lib/formatters";
import type { GitStatus } from "./lib/git";
import { getGitStatus } from "./lib/git";
import {
	type RawGitData,
	type RawStatuslineData,
	renderStatusline,
	renderStatuslineRaw,
	type StatuslineData,
	type TokenBreakdownData,
	type UsageLimit,
} from "./lib/render-pure";
import type { HookInput } from "./lib/types";

type GetUsageLimits = typeof import("./lib/features/limits").getUsageLimits;
type NormalizeResetsAt = (resetsAt: string) => string;
type GetPeriodCost = typeof import("./lib/features/spend").getPeriodCost;
type GetWeekCost = typeof import("./lib/features/spend").getWeekCost;
type SaveSessionV2 = typeof import("./lib/features/spend").saveSessionV2;
type GetDailyTokens = typeof import("./lib/features/spend").getDailyTokens;

type UsageLimitsResult = {
	five_hour: { utilization: number; resets_at: string | null } | null;
	seven_day: { utilization: number; resets_at: string | null } | null;
};

// Optional feature imports - just delete the folder to disable!
let getUsageLimits: GetUsageLimits | null = null;
let normalizeResetsAt: NormalizeResetsAt | null = null;
let getPeriodCost: GetPeriodCost | null = null;
let getWeekCost: GetWeekCost | null = null;
let saveSessionV2: SaveSessionV2 | null = null;
let getDailyTokens: GetDailyTokens | null = null;

function gitStatusToRawGit(git: GitStatus): RawGitData {
	return {
		branch: git.branch,
		dirty: git.hasChanges,
		staged: git.staged,
		unstaged: git.unstaged,
	};
}

try {
	const limitsModule = await import("./lib/features/limits");
	getUsageLimits = limitsModule.getUsageLimits;
} catch {
	// Limits feature not available - that's OK!
}

try {
	const periodModule = await import("./lib/period");
	normalizeResetsAt = periodModule.normalizeResetsAt;
} catch {
	normalizeResetsAt = (resetsAt: string) => resetsAt;
}

try {
	const spendModule = await import("./lib/features/spend");
	getPeriodCost = spendModule.getPeriodCost;
	getWeekCost = spendModule.getWeekCost;
	saveSessionV2 = spendModule.saveSessionV2;
	getDailyTokens = spendModule.getDailyTokens;
} catch {
	// Spend tracking feature not available - that's OK!
}

// Re-export from render-pure for backwards compatibility
export {
	renderStatusline,
	type StatuslineData,
	type UsageLimit,
} from "./lib/render-pure";

const LAST_PAYLOAD_PATH = join(
	import.meta.dir,
	"..",
	"data",
	"last_payload.txt",
);

// Context window configuration
const USE_PAYLOAD_CONTEXT = true;
const MAX_CONTEXT_TOKENS = 200000;
const AUTOCOMPACT_BUFFER_TOKENS = 45000;
const USE_USABLE_CONTEXT_ONLY = true;
const OVERHEAD_TOKENS = 0;

async function main() {
	try {
		const input: HookInput = await Bun.stdin.json();

		// Save last payload for debugging
		await writeFile(LAST_PAYLOAD_PATH, JSON.stringify(input, null, 2));

		// Get usage limits — prefer hook payload (no extra API call), fall back to API
		let usageLimits: UsageLimitsResult;
		if (input.rate_limits) {
			usageLimits = {
				five_hour: input.rate_limits.five_hour
					? {
							utilization: input.rate_limits.five_hour.used_percentage,
							resets_at: new Date(
								input.rate_limits.five_hour.resets_at * 1000,
							).toISOString(),
						}
					: null,
				seven_day: input.rate_limits.seven_day
					? {
							utilization: input.rate_limits.seven_day.used_percentage,
							resets_at: new Date(
								input.rate_limits.seven_day.resets_at * 1000,
							).toISOString(),
						}
					: null,
			};
		} else if (getUsageLimits) {
			usageLimits = await getUsageLimits();
		} else {
			usageLimits = { five_hour: null, seven_day: null };
		}
		const currentResetsAt = usageLimits.five_hour?.resets_at ?? undefined;

		// Save session with current period context (if feature exists)
		if (saveSessionV2) {
			await saveSessionV2(input, currentResetsAt);
		}

		const git = await getGitStatus();

		let contextTokens: number | null;
		let contextPercentage: number | null;

		if (USE_PAYLOAD_CONTEXT && input.context_window) {
			const current = input.context_window?.current_usage;
			if (current) {
				contextTokens =
					(current.input_tokens || 0) +
					(current.cache_creation_input_tokens || 0) +
					(current.cache_read_input_tokens || 0);
				const maxTokens =
					input.context_window?.context_window_size || MAX_CONTEXT_TOKENS;
				contextPercentage = Math.min(
					100,
					Math.round((contextTokens / maxTokens) * 100),
				);
			} else {
				contextTokens = null;
				contextPercentage = null;
			}
		} else {
			const contextData = await getContextData({
				transcriptPath: input.transcript_path,
				maxContextTokens: MAX_CONTEXT_TOKENS,
				autocompactBufferTokens: AUTOCOMPACT_BUFFER_TOKENS,
				useUsableContextOnly: USE_USABLE_CONTEXT_ONLY,
				overheadTokens: OVERHEAD_TOKENS,
			});
			contextTokens = contextData.tokens;
			contextPercentage = contextData.percentage;
		}

		// Get period cost from SQLite (if feature exists)
		let periodCost: number | undefined;
		let weekCost: number | undefined;

		if (getPeriodCost && normalizeResetsAt) {
			const normalizedPeriodId = currentResetsAt
				? normalizeResetsAt(currentResetsAt)
				: null;
			periodCost = normalizedPeriodId ? getPeriodCost(normalizedPeriodId) : 0;
		}

		if (getWeekCost && usageLimits.seven_day?.resets_at) {
			weekCost = getWeekCost(usageLimits.seven_day.resets_at);
		}

		// Token breakdown — always show last known data if available
		const today = new Date().toISOString().slice(0, 10);
		let tokenBreakdown: TokenBreakdownData | null = null;
		if (getDailyTokens) {
			tokenBreakdown = getDailyTokens(today);
		}

		// Daily cost from ccusage
		const todayCost = tokenBreakdown?.totalCost ?? 0;

		const data: RawStatuslineData = {
			git: gitStatusToRawGit(git),
			path: formatPath(input.workspace.current_dir, "truncated"),
			modelName: input.model.display_name,
			contextWindowSize: input.context_window?.context_window_size,
			cost: input.cost.total_cost_usd,
			durationMs: input.cost.total_duration_ms,
			contextTokens,
			contextPercentage,
			...(getUsageLimits && {
				usageLimits: {
					five_hour: usageLimits.five_hour
						? {
								utilization: usageLimits.five_hour.utilization,
								resets_at: usageLimits.five_hour.resets_at,
							}
						: null,
					seven_day: usageLimits.seven_day
						? {
								utilization: usageLimits.seven_day.utilization,
								resets_at: usageLimits.seven_day.resets_at,
							}
						: null,
				},
			}),
			...(getPeriodCost && { periodCost }),
			todayCost,
			...(getWeekCost && { weekCost }),
			...(getDailyTokens && { tokenBreakdown }),
		};

		const output = renderStatuslineRaw(data);
		console.log(output);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.log(`${colors.red("Error:")} ${errorMessage}`);
	}
}

main();
