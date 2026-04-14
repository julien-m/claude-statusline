import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	getSessionTokenBreakdown,
	resetDb,
	type SessionTokenRow,
	setDb,
	upsertSessionTokenBreakdown,
} from "../lib/features/spend/index";

function buildRow(overrides: Partial<SessionTokenRow> = {}): SessionTokenRow {
	return {
		sessionId: "test-session-123",
		inputTokens: 100,
		outputTokens: 500,
		cacheCreationTokens: 2000,
		cacheReadTokens: 50000,
		totalCost: 0.025,
		...overrides,
	};
}

describe("Session Token Breakdown Table", () => {
	beforeEach(() => {
		const db = new Database(":memory:");
		db.run("PRAGMA journal_mode = WAL");
		db.run(`
			CREATE TABLE IF NOT EXISTS session_token_breakdown (
				session_id            TEXT PRIMARY KEY,
				input_tokens          INTEGER NOT NULL DEFAULT 0,
				output_tokens         INTEGER NOT NULL DEFAULT 0,
				cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
				cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
				total_cost            REAL NOT NULL DEFAULT 0,
				updated_at            TEXT NOT NULL
			)
		`);
		setDb(db);
	});

	afterEach(() => {
		resetDb();
	});

	test("upsert creates a new row", () => {
		const row = buildRow();
		upsertSessionTokenBreakdown(row);
		const result = getSessionTokenBreakdown("test-session-123");
		expect(result).not.toBeNull();
		expect(result?.inputTokens).toBe(100);
		expect(result?.totalCost).toBeCloseTo(0.025);
	});

	test("upsert updates existing row", () => {
		upsertSessionTokenBreakdown(buildRow({ totalCost: 0.025 }));
		upsertSessionTokenBreakdown(
			buildRow({ totalCost: 0.05, outputTokens: 1000 }),
		);
		const result = getSessionTokenBreakdown("test-session-123");
		expect(result?.totalCost).toBeCloseTo(0.05);
		expect(result?.outputTokens).toBe(1000);
	});

	test("returns null for unknown session", () => {
		expect(getSessionTokenBreakdown("nonexistent-session")).toBeNull();
	});

	test("multiple sessions stored independently", () => {
		upsertSessionTokenBreakdown(
			buildRow({ sessionId: "session-a", totalCost: 0.01 }),
		);
		upsertSessionTokenBreakdown(
			buildRow({ sessionId: "session-b", totalCost: 0.02 }),
		);
		expect(getSessionTokenBreakdown("session-a")?.totalCost).toBeCloseTo(0.01);
		expect(getSessionTokenBreakdown("session-b")?.totalCost).toBeCloseTo(0.02);
	});

	test("get maps all column names to camelCase correctly", () => {
		upsertSessionTokenBreakdown(
			buildRow({ cacheCreationTokens: 2000, cacheReadTokens: 50000 }),
		);
		const result = getSessionTokenBreakdown("test-session-123");
		expect(result?.cacheCreationTokens).toBe(2000);
		expect(result?.cacheReadTokens).toBe(50000);
	});
});
