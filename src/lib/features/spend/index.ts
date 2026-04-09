import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { HookInput } from "../../types";

const DATA_DIR = join(import.meta.dir, "..", "..", "..", "..", "data");
const DB_PATH = join(DATA_DIR, "spend.db");

function ensureDataDir(): void {
	if (!existsSync(DATA_DIR)) {
		mkdirSync(DATA_DIR, { recursive: true });
	}
}

let _db: Database | null = null;

export function getDb(): Database {
	if (_db) return _db;

	ensureDataDir();
	_db = new Database(DB_PATH);
	_db.run("PRAGMA journal_mode = WAL");

	_db.run(`
		CREATE TABLE IF NOT EXISTS sessions (
			session_id TEXT PRIMARY KEY,
			total_cost REAL NOT NULL DEFAULT 0,
			cwd TEXT NOT NULL,
			date TEXT NOT NULL,
			duration_ms INTEGER NOT NULL DEFAULT 0,
			lines_added INTEGER NOT NULL DEFAULT 0,
			lines_removed INTEGER NOT NULL DEFAULT 0,
			last_resets_at TEXT
		)
	`);

	_db.run(`
		CREATE TABLE IF NOT EXISTS session_period_tracking (
			session_id TEXT NOT NULL,
			period_id TEXT NOT NULL,
			counted_cost REAL NOT NULL DEFAULT 0,
			last_session_cost REAL NOT NULL DEFAULT 0,
			PRIMARY KEY (session_id, period_id)
		)
	`);

	_db.run(`
		CREATE TABLE IF NOT EXISTS periods (
			period_id TEXT PRIMARY KEY,
			total_cost REAL NOT NULL DEFAULT 0,
			utilization INTEGER NOT NULL DEFAULT 0,
			date TEXT NOT NULL
		)
	`);

	return _db;
}

export function saveSessionV2(input: HookInput, resetsAt?: string): void {
	try {
		const db = getDb();
		const sessionId = input.session_id;
		const currentCost = input.cost.total_cost_usd;
		const today = new Date().toISOString().split("T")[0];

		// Upsert session
		const existing = db
			.query<
				{ total_cost: number; last_resets_at: string | null },
				[string]
			>("SELECT total_cost, last_resets_at FROM sessions WHERE session_id = ?")
			.get(sessionId);

		if (!existing) {
			db.run(
				"INSERT INTO sessions (session_id, total_cost, cwd, date, duration_ms, lines_added, lines_removed, last_resets_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
				[
					sessionId,
					currentCost,
					input.cwd,
					today,
					input.cost.total_duration_ms,
					input.cost.total_lines_added,
					input.cost.total_lines_removed,
					resetsAt ?? null,
				],
			);
		} else {
			db.run(
				"UPDATE sessions SET total_cost = ?, duration_ms = ?, lines_added = ?, lines_removed = ?, last_resets_at = ? WHERE session_id = ?",
				[
					currentCost,
					input.cost.total_duration_ms,
					input.cost.total_lines_added,
					input.cost.total_lines_removed,
					resetsAt ?? existing.last_resets_at,
					sessionId,
				],
			);
		}

		// Track period cost if we have a resetsAt
		if (resetsAt) {
			const periodId = resetsAt;
			const previousCost = existing?.total_cost ?? 0;

			const tracking = db
				.query<
					{ counted_cost: number; last_session_cost: number },
					[string, string]
				>(
					"SELECT counted_cost, last_session_cost FROM session_period_tracking WHERE session_id = ? AND period_id = ?",
				)
				.get(sessionId, periodId);

			if (!tracking) {
				// New session in this period - count delta from last known cost
				const delta = currentCost - previousCost;
				db.run(
					"INSERT INTO session_period_tracking (session_id, period_id, counted_cost, last_session_cost) VALUES (?, ?, ?, ?)",
					[sessionId, periodId, delta > 0 ? delta : currentCost, currentCost],
				);

				// Ensure period exists
				db.run(
					"INSERT OR IGNORE INTO periods (period_id, total_cost, utilization, date) VALUES (?, 0, 0, ?)",
					[periodId, today],
				);

				db.run(
					"UPDATE periods SET total_cost = total_cost + ? WHERE period_id = ?",
					[delta > 0 ? delta : currentCost, periodId],
				);
			} else {
				// Continuing session - only add delta
				const delta = currentCost - tracking.last_session_cost;
				if (delta > 0) {
					db.run(
						"UPDATE session_period_tracking SET counted_cost = counted_cost + ?, last_session_cost = ? WHERE session_id = ? AND period_id = ?",
						[delta, currentCost, sessionId, periodId],
					);

					db.run(
						"UPDATE periods SET total_cost = total_cost + ? WHERE period_id = ?",
						[delta, periodId],
					);
				}
			}
		}
	} catch {
		// Fail silently - don't break the statusline
	}
}

export function getPeriodCost(periodId: string): number {
	try {
		const db = getDb();
		const result = db
			.query<{ total_cost: number }, [string]>(
				"SELECT total_cost FROM periods WHERE period_id = ?",
			)
			.get(periodId);
		return result?.total_cost ?? 0;
	} catch {
		return 0;
	}
}

export function getWeekCost(sevenDayResetsAt: string): number {
	try {
		const db = getDb();
		const windowStart = new Date(new Date(sevenDayResetsAt).getTime() - 7 * 24 * 3600 * 1000);
		const windowStartDate = windowStart.toISOString().split("T")[0];
		const result = db
			.query<{ total: number }, [string]>(
				"SELECT COALESCE(SUM(total_cost), 0) as total FROM sessions WHERE date >= ?",
			)
			.get(windowStartDate);
		return result?.total ?? 0;
	} catch {
		return 0;
	}
}

export function getTodayCostV2(): number {
	try {
		const db = getDb();
		const today = new Date().toISOString().split("T")[0];
		const result = db
			.query<{ total: number }, [string]>(
				"SELECT COALESCE(SUM(total_cost), 0) as total FROM sessions WHERE date = ?",
			)
			.get(today);
		return result?.total ?? 0;
	} catch {
		return 0;
	}
}
