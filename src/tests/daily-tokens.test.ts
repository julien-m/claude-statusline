import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getDailyTokens, upsertDailyTokens, type DailyTokensRow } from "../lib/features/spend/index";

const TEST_DB_PATH = join(import.meta.dir, "..", "..", "data", "test-daily-tokens.db");

describe("Daily Tokens Table", () => {
	let db: Database;

	beforeEach(() => {
		if (existsSync(TEST_DB_PATH)) {
			rmSync(TEST_DB_PATH);
		}

		db = new Database(TEST_DB_PATH);
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
	});

	afterEach(() => {
		db.close();
		if (existsSync(TEST_DB_PATH)) {
			rmSync(TEST_DB_PATH);
		}
	});

	test("upsert creates new row", () => {
		const row: DailyTokensRow = {
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
		};

		db.run(
			`INSERT INTO daily_tokens (
				date, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
				block_cost, block_remaining_min, block_projection_cost, burn_rate_per_hour,
				total_cost, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				row.date,
				row.inputTokens,
				row.outputTokens,
				row.cacheCreationTokens,
				row.cacheReadTokens,
				row.blockCost,
				row.blockRemainingMin,
				row.blockProjectionCost,
				row.burnRatePerHour,
				row.totalCost,
				row.updatedAt,
			],
		);

		const result = db
			.query<{
				date: string;
				input_tokens: number;
				output_tokens: number;
				cache_creation_tokens: number;
				cache_read_tokens: number;
				block_cost: number;
				block_remaining_min: number;
				block_projection_cost: number;
				burn_rate_per_hour: number;
				total_cost: number;
				updated_at: string;
			}>("SELECT * FROM daily_tokens WHERE date = ?")
			.get(row.date);

		expect(result?.date).toBe("2026-04-09");
		expect(result?.input_tokens).toBe(1000);
		expect(result?.output_tokens).toBe(500);
		expect(result?.total_cost).toBe(25.0);
	});

	test("upsert updates existing row", () => {
		const date = "2026-04-09";

		// Insert initial row
		db.run(
			`INSERT INTO daily_tokens (
				date, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
				block_cost, block_remaining_min, block_projection_cost, burn_rate_per_hour,
				total_cost, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				date,
				1000,
				500,
				100,
				50,
				10.5,
				120,
				15.75,
				2.5,
				25.0,
				"2026-04-09T12:00:00.000Z",
			],
		);

		// Update via upsert
		db.run(
			`INSERT INTO daily_tokens (
				date, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
				block_cost, block_remaining_min, block_projection_cost, burn_rate_per_hour,
				total_cost, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(date) DO UPDATE SET
				input_tokens = excluded.input_tokens,
				output_tokens = excluded.output_tokens,
				cache_creation_tokens = excluded.cache_creation_tokens,
				cache_read_tokens = excluded.cache_read_tokens,
				block_cost = excluded.block_cost,
				block_remaining_min = excluded.block_remaining_min,
				block_projection_cost = excluded.block_projection_cost,
				burn_rate_per_hour = excluded.burn_rate_per_hour,
				total_cost = excluded.total_cost,
				updated_at = excluded.updated_at`,
			[
				date,
				1500,
				750,
				150,
				75,
				15.5,
				90,
				25.0,
				3.5,
				50.0,
				"2026-04-09T13:00:00.000Z",
			],
		);

		const result = db
			.query<{
				input_tokens: number;
				output_tokens: number;
				total_cost: number;
				updated_at: string;
			}>("SELECT input_tokens, output_tokens, total_cost, updated_at FROM daily_tokens WHERE date = ?")
			.get(date);

		expect(result?.input_tokens).toBe(1500);
		expect(result?.output_tokens).toBe(750);
		expect(result?.total_cost).toBe(50.0);
		expect(result?.updated_at).toBe("2026-04-09T13:00:00.000Z");
	});

	test("get returns row when it exists", () => {
		const date = "2026-04-09";

		db.run(
			`INSERT INTO daily_tokens (
				date, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
				block_cost, block_remaining_min, block_projection_cost, burn_rate_per_hour,
				total_cost, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				date,
				1000,
				500,
				100,
				50,
				10.5,
				120,
				15.75,
				2.5,
				25.0,
				"2026-04-09T12:00:00.000Z",
			],
		);

		const result = db
			.query<{
				date: string;
				input_tokens: number;
				output_tokens: number;
				cache_creation_tokens: number;
				cache_read_tokens: number;
				block_cost: number;
				block_remaining_min: number;
				block_projection_cost: number;
				burn_rate_per_hour: number;
				total_cost: number;
				updated_at: string;
			}>(
				"SELECT date, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, block_cost, block_remaining_min, block_projection_cost, burn_rate_per_hour, total_cost, updated_at FROM daily_tokens WHERE date = ?",
			)
			.get(date);

		expect(result?.date).toBe("2026-04-09");
		expect(result?.inputTokens).toBeUndefined();
		expect(result?.input_tokens).toBe(1000);
		expect(result?.total_cost).toBe(25.0);
	});

	test("get returns null when row does not exist", () => {
		const result = db
			.query<{ date: string }>(
				"SELECT * FROM daily_tokens WHERE date = ?",
			)
			.get("2026-04-09");

		expect(result).toBeNull();
	});

	test("interface has correct structure", () => {
		const row: DailyTokensRow = {
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
		};

		expect(row.date).toBe("2026-04-09");
		expect(row.inputTokens).toBe(1000);
		expect(row.outputTokens).toBe(500);
		expect(row.cacheCreationTokens).toBe(100);
		expect(row.cacheReadTokens).toBe(50);
		expect(row.blockCost).toBe(10.5);
		expect(row.blockRemainingMin).toBe(120);
		expect(row.blockProjectionCost).toBe(15.75);
		expect(row.burnRatePerHour).toBe(2.5);
		expect(row.totalCost).toBe(25.0);
		expect(row.updatedAt).toBe("2026-04-09T12:00:00.000Z");
	});
});
