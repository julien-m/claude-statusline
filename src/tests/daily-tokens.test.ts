import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	type DailyTokensRow,
	getDailyTokens,
	resetDb,
	setDb,
	upsertDailyTokens,
} from "../lib/features/spend/index";

function buildRow(overrides: Partial<DailyTokensRow> = {}): DailyTokensRow {
	return {
		date: "2026-04-09",
		inputTokens: 1000,
		outputTokens: 500,
		cacheCreationTokens: 100,
		cacheReadTokens: 50,
		blockCost: 10.5,
		blockRemainingMin: 120,
		blockProjectionCost: 15.75,
		burnRatePerHour: 2.5,
		totalCost: 25.0,
		updatedAt: "2026-04-09T12:00:00.000Z",
		...overrides,
	};
}

describe("Daily Tokens Table", () => {
	beforeEach(() => {
		const db = new Database(":memory:");
		db.run("PRAGMA journal_mode = WAL");
		db.run(`
			CREATE TABLE IF NOT EXISTS daily_tokens (
				date                   TEXT PRIMARY KEY,
				input_tokens           INTEGER NOT NULL DEFAULT 0,
				output_tokens          INTEGER NOT NULL DEFAULT 0,
				cache_creation_tokens  INTEGER NOT NULL DEFAULT 0,
				cache_read_tokens      INTEGER NOT NULL DEFAULT 0,
				block_cost             REAL NOT NULL DEFAULT 0,
				block_remaining_min    INTEGER NOT NULL DEFAULT 0,
				block_projection_cost  REAL NOT NULL DEFAULT 0,
				burn_rate_per_hour     REAL NOT NULL DEFAULT 0,
				total_cost             REAL NOT NULL DEFAULT 0,
				updated_at             TEXT NOT NULL
			)
		`);
		setDb(db);
	});

	afterEach(() => {
		resetDb();
	});

	test("upsert creates a new row", () => {
		const row = buildRow();
		upsertDailyTokens(row);

		const result = getDailyTokens("2026-04-09");
		expect(result).not.toBeNull();
		expect(result?.inputTokens).toBe(1000);
		expect(result?.outputTokens).toBe(500);
		expect(result?.totalCost).toBe(25.0);
	});

	test("upsert updates an existing row (ON CONFLICT)", () => {
		const initial = buildRow({ totalCost: 10.0, inputTokens: 500 });
		upsertDailyTokens(initial);

		const updated = buildRow({ totalCost: 20.0, inputTokens: 1500 });
		upsertDailyTokens(updated);

		const result = getDailyTokens("2026-04-09");
		expect(result?.totalCost).toBe(20.0);
		expect(result?.inputTokens).toBe(1500);
	});

	test("getDailyTokens returns null for missing date", () => {
		const result = getDailyTokens("1999-01-01");
		expect(result).toBeNull();
	});

	test("getDailyTokens maps column names to camelCase correctly", () => {
		const row = buildRow({
			cacheCreationTokens: 200,
			cacheReadTokens: 300,
			burnRatePerHour: 5.5,
			blockProjectionCost: 99.9,
		});
		upsertDailyTokens(row);

		const result = getDailyTokens("2026-04-09");
		expect(result?.cacheCreationTokens).toBe(200);
		expect(result?.cacheReadTokens).toBe(300);
		expect(result?.burnRatePerHour).toBe(5.5);
		expect(result?.blockProjectionCost).toBe(99.9);
	});

	test("upsert of different dates are independent", () => {
		upsertDailyTokens(buildRow({ date: "2026-04-08", totalCost: 5.0 }));
		upsertDailyTokens(buildRow({ date: "2026-04-09", totalCost: 10.0 }));

		expect(getDailyTokens("2026-04-08")?.totalCost).toBe(5.0);
		expect(getDailyTokens("2026-04-09")?.totalCost).toBe(10.0);
	});
});
