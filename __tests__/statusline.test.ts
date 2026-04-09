import { describe, expect, it } from "bun:test";
import {
	type RawStatuslineData,
	renderStatuslineRaw,
} from "../src/lib/render-pure";

function buildData(
	overrides: Partial<RawStatuslineData> = {},
): RawStatuslineData {
	return {
		git: {
			branch: "main",
			dirty: false,
			staged: { files: 0, added: 0, deleted: 0 },
			unstaged: { files: 0, added: 0, deleted: 0 },
		},
		path: "~/project",
		modelName: "Sonnet 4.5",
		cost: 0.17,
		durationMs: 360000,
		contextTokens: 50000,
		contextPercentage: 25,
		todayCost: 2.0,
		...overrides,
	};
}

describe("renderStatuslineRaw", () => {
	describe("basic rendering", () => {
		it("includes branch name in output", () => {
			const output = renderStatuslineRaw(buildData());
			expect(output).toContain("main");
		});

		it("includes directory path in output", () => {
			const output = renderStatuslineRaw(buildData({ path: "~/my-project" }));
			expect(output).toContain("my-project");
		});

		it("includes model name in output", () => {
			const output = renderStatuslineRaw(buildData({ modelName: "Opus 4.5" }));
			expect(output).toContain("Opus");
		});

		it("renders on two lines", () => {
			const output = renderStatuslineRaw(buildData());
			expect(output).toContain("\n");
		});
	});

	describe("git status", () => {
		it("shows branch name with dirty indicator when there are changes", () => {
			const output = renderStatuslineRaw(
				buildData({
					git: {
						branch: "feat/my-branch",
						dirty: true,
						staged: { files: 1, added: 10, deleted: 2 },
						unstaged: { files: 0, added: 0, deleted: 0 },
					},
				}),
			);
			expect(output).toContain("feat/my-branch");
		});

		it("handles null git gracefully", () => {
			const output = renderStatuslineRaw(buildData({ git: null }));
			expect(typeof output).toBe("string");
		});
	});

	describe("context usage", () => {
		it("includes context percentage in output", () => {
			const output = renderStatuslineRaw(
				buildData({ contextPercentage: 45, contextTokens: 90000 }),
			);
			expect(output).toContain("45");
		});

		it("handles null context tokens gracefully", () => {
			const output = renderStatuslineRaw(
				buildData({ contextTokens: null, contextPercentage: null }),
			);
			expect(typeof output).toBe("string");
		});
	});

	describe("usage limits", () => {
		it("includes limit utilization when provided", () => {
			const output = renderStatuslineRaw(
				buildData({
					usageLimits: {
						five_hour: { utilization: 50, resets_at: "2025-01-01T15:00:00Z" },
						seven_day: null,
					},
				}),
			);
			expect(output).toContain("50");
		});

		it("renders cleanly without usage limits", () => {
			const output = renderStatuslineRaw(buildData({ usageLimits: undefined }));
			expect(typeof output).toBe("string");
		});
	});

	describe("cost display", () => {
		it("includes session cost indicator", () => {
			const output = renderStatuslineRaw(buildData({ cost: 1.5 }));
			expect(output).toContain("$");
		});
	});
});
