import { $ } from "bun";
import { platform } from "node:os";

export interface UsageLimitData {
	utilization: number;
	resets_at: string | null;
}

export interface UsageLimitsResult {
	five_hour: UsageLimitData | null;
	seven_day: UsageLimitData | null;
}

async function getOAuthToken(): Promise<string | null> {
	try {
		if (platform() === "darwin") {
			const result =
				await $`security find-generic-password -s "Claude Code-credentials" -w`.text();
			const parsed = JSON.parse(result.trim());
			return parsed?.claudeAiOauth?.accessToken ?? null;
		}

		// Linux/Windows: read from credentials file
		const { readFile } = await import("node:fs/promises");
		const { join } = await import("node:path");
		const { homedir } = await import("node:os");
		const credPath = join(homedir(), ".claude", ".credentials.json");
		const content = await readFile(credPath, "utf-8");
		const parsed = JSON.parse(content);
		return parsed?.claudeAiOauth?.accessToken ?? null;
	} catch {
		return null;
	}
}

export async function getUsageLimits(): Promise<UsageLimitsResult> {
	try {
		const token = await getOAuthToken();
		if (!token) return { five_hour: null, seven_day: null };

		const response = await fetch(
			"https://api.anthropic.com/api/oauth/usage",
			{
				method: "GET",
				headers: {
					Accept: "application/json, text/plain, */*",
					"Content-Type": "application/json",
					"User-Agent": "claude-code/2.0.31",
					Authorization: `Bearer ${token}`,
					"anthropic-beta": "oauth-2025-04-20",
					"Accept-Encoding": "gzip, compress, deflate, br",
				},
			},
		);

		if (!response.ok) return { five_hour: null, seven_day: null };

		const data = await response.json();

		return {
			five_hour: data.five_hour
				? {
						utilization: data.five_hour.utilization ?? 0,
						resets_at: data.five_hour.resets_at ?? null,
					}
				: null,
			seven_day: data.seven_day
				? {
						utilization: data.seven_day.utilization ?? 0,
						resets_at: data.seven_day.resets_at ?? null,
					}
				: null,
		};
	} catch {
		return { five_hour: null, seven_day: null };
	}
}
