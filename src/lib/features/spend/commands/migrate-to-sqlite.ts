#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import pc from "picocolors";

const pico = pc.createColors(true);

const DATA_DIR = join(import.meta.dir, "..", "..", "..", "..", "..", "data");
const DB_PATH = join(DATA_DIR, "spend.db");

function main() {
	console.log(pico.bold("\nSQLite Spend Database Migration\n"));

	// Ensure data directory exists
	if (!existsSync(DATA_DIR)) {
		mkdirSync(DATA_DIR, { recursive: true });
		console.log(pico.green(`Created data directory: ${DATA_DIR}`));
	}

	const dbExists = existsSync(DB_PATH);

	const db = new Database(DB_PATH);
	db.run("PRAGMA journal_mode = WAL");

	// Create tables
	db.run(`
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
	console.log(pico.green("  sessions table ready"));

	db.run(`
		CREATE TABLE IF NOT EXISTS session_period_tracking (
			session_id TEXT NOT NULL,
			period_id TEXT NOT NULL,
			counted_cost REAL NOT NULL DEFAULT 0,
			last_session_cost REAL NOT NULL DEFAULT 0,
			PRIMARY KEY (session_id, period_id)
		)
	`);
	console.log(pico.green("  session_period_tracking table ready"));

	db.run(`
		CREATE TABLE IF NOT EXISTS periods (
			period_id TEXT PRIMARY KEY,
			total_cost REAL NOT NULL DEFAULT 0,
			utilization INTEGER NOT NULL DEFAULT 0,
			date TEXT NOT NULL
		)
	`);
	console.log(pico.green("  periods table ready"));

	// Create useful indexes
	db.run(
		"CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date)",
	);
	db.run(
		"CREATE INDEX IF NOT EXISTS idx_sessions_cwd ON sessions(cwd)",
	);
	db.run(
		"CREATE INDEX IF NOT EXISTS idx_periods_date ON periods(date)",
	);
	console.log(pico.green("  indexes ready"));

	// Show stats
	const sessionCount = db
		.query<{ count: number }>("SELECT COUNT(*) as count FROM sessions")
		.get();
	const periodCount = db
		.query<{ count: number }>("SELECT COUNT(*) as count FROM periods")
		.get();

	console.log(
		`\n${pico.bold("Database:")} ${DB_PATH}`,
	);
	console.log(
		`${pico.bold("Sessions:")} ${sessionCount?.count ?? 0}`,
	);
	console.log(
		`${pico.bold("Periods:")} ${periodCount?.count ?? 0}`,
	);

	if (dbExists) {
		console.log(
			pico.yellow("\nDatabase already existed — tables verified/updated."),
		);
	} else {
		console.log(
			pico.green("\nFresh database created successfully."),
		);
	}

	db.close();
	console.log("");
}

main();
