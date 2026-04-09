#!/usr/bin/env bun

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultConfig, type StatuslineConfig } from "./lib/config";
import { getContextData } from "./lib/context";
import {
	colors,
	formatBranch,
	formatCost,
	formatDuration,
	formatPath,
} from "./lib/formatters";
import { getGitStatus } from "./lib/git";
import {
	renderStatusline,
	type StatuslineData,
	type TokenBreakdownData,
	type UsageLimit,
} from "./lib/render-pure";
import type { HookInput } from "./lib/types";

// Optional feature imports - just delete the folder to disable!
let getUsageLimits: any = null;
let normalizeResetsAt: any = null;
let getPeriodCost: any = null;
let getTodayCostV2: any = null;
let getWeekCost: any = null;
let saveSessionV2: any = null;
let getDailyTokens: any = null;

try {
	const limitsModule = await import("./lib/features/limits");
	getUsageLimits = limitsModule.getUsageLimits;
} catch {
	// Limits feature not available - that's OK!
}

try {
	const utilsModule = await import("./lib/utils");
	normalizeResetsAt = utilsModule.normalizeResetsAt;
} catch {
	// Fallback normalizeResetsAt
	normalizeResetsAt = (resetsAt: string) => resetsAt;
}

try {
	const spendModule = await import("./lib/features/spend");
	getPeriodCost = spendModule.getPeriodCost;
	getTodayCostV2 = spendModule.getTodayCostV2;
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

const CONFIG_FILE_PATH = join(import.meta.dir, "..", "statusline.config.json");
const LAST_PAYLOAD_PATH = join(
	import.meta.dir,
	"..",
	"data",
	"last_payload.txt",
);

async function loadConfig(): Promise<StatuslineConfig> {
	try {
		const content = await readFile(CONFIG_FILE_PATH, "utf-8");
		return JSON.parse(content);
	} catch {
		return defaultConfig;
	}
}

async function main() {
	try {
		const input: HookInput = await Bun.stdin.json();

		// Save last payload for debugging
		await writeFile(LAST_PAYLOAD_PATH, JSON.stringify(input, null, 2));

		const config = await loadConfig();

		// Get usage limits — prefer hook payload (no extra API call), fall back to API
		let usageLimits: { five_hour: { utilization: number; resets_at: string } | null; seven_day: { utilization: number; resets_at: string } | null };
		if (input.rate_limits) {
			usageLimits = {
				five_hour: input.rate_limits.five_hour
					? {
							utilization: input.rate_limits.five_hour.used_percentage,
							resets_at: new Date(input.rate_limits.five_hour.resets_at * 1000).toISOString(),
						}
					: null,
				seven_day: input.rate_limits.seven_day
					? {
							utilization: input.rate_limits.seven_day.used_percentage,
							resets_at: new Date(input.rate_limits.seven_day.resets_at * 1000).toISOString(),
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

		const usePayloadContext =
			config.context.usePayloadContextWindow && input.context_window;

		if (usePayloadContext) {
			const current = input.context_window?.current_usage;
			if (current) {
				contextTokens =
					(current.input_tokens || 0) +
					(current.cache_creation_input_tokens || 0) +
					(current.cache_read_input_tokens || 0);
				const maxTokens =
					input.context_window?.context_window_size ||
					config.context.maxContextTokens;
				contextPercentage = Math.min(
					100,
					Math.round((contextTokens / maxTokens) * 100),
				);
			} else {
				// No context data yet - session not started
				contextTokens = null;
				contextPercentage = null;
			}
		} else {
			const contextData = await getContextData({
				transcriptPath: input.transcript_path,
				maxContextTokens: config.context.maxContextTokens,
				autocompactBufferTokens: config.context.autocompactBufferTokens,
				useUsableContextOnly: config.context.useUsableContextOnly,
				overheadTokens: config.context.overheadTokens,
			});
			contextTokens = contextData.tokens;
			contextPercentage = contextData.percentage;
		}

		// Get period cost from SQLite (if feature exists)
		let periodCost: number | undefined;
		let todayCost: number | undefined;
		let weekCost: number | undefined;

		if (getPeriodCost && getTodayCostV2 && normalizeResetsAt) {
			const normalizedPeriodId = currentResetsAt
				? normalizeResetsAt(currentResetsAt)
				: null;
			periodCost = normalizedPeriodId ? getPeriodCost(normalizedPeriodId) : 0;
			todayCost = getTodayCostV2();
		}

		if (getWeekCost && usageLimits.seven_day?.resets_at) {
			weekCost = getWeekCost(usageLimits.seven_day.resets_at);
		}

		// Token breakdown — fetch from DB and check freshness
		const STALE_THRESHOLD_MS = 3 * 60 * 1000; // 3 min = 3× cron interval
		const today = new Date().toISOString().slice(0, 10); // UTC — consistent with sessions table and ccusage
		let tokenBreakdown: TokenBreakdownData | null = null;
		if (getDailyTokens && config.tokenBreakdown?.enabled) {
			const rawTokens = getDailyTokens(today);
			if (rawTokens && Date.now() - new Date(rawTokens.updatedAt).getTime() < STALE_THRESHOLD_MS) {
				tokenBreakdown = rawTokens;
			}
		}

		const data: StatuslineData = {
			branch: formatBranch(git, config.git),
			dirPath: formatPath(input.workspace.current_dir, config.pathDisplayMode),
			modelName: input.model.display_name,
			contextWindowSize: input.context_window?.context_window_size,
			sessionCost: formatCost(
				input.cost.total_cost_usd,
				config.session.cost.format,
			),
			sessionDuration: formatDuration(input.cost.total_duration_ms),
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
			...((getPeriodCost || getTodayCostV2) && { periodCost, todayCost }),
			...(getWeekCost && { weekCost }),
			...(getDailyTokens && { tokenBreakdown }),
		};

		const output = renderStatusline(data, config);
		console.log(output);
		if (config.oneLine) {
			console.log("");
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.log(`${colors.red("Error:")} ${errorMessage}`);
		console.log(colors.gray("Check statusline configuration"));
	}
}

main();
