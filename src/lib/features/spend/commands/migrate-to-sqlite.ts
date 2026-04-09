#!/usr/bin/env bun

import pc from "picocolors";
import { getDb } from "../index";

const pico = pc.createColors(true);

function main() {
	console.log(pico.bold("\nSQLite Spend Database Migration\n"));

	// getDb() creates all tables and indexes from the authoritative schema in spend/index.ts
	const db = getDb();

	console.log(pico.green("✓ Database initialized with authoritative schema"));
	console.log(pico.gray("  Tables: sessions, session_period_tracking, periods, daily_tokens"));
	console.log(pico.gray("  Indexes: idx_sessions_date, idx_sessions_cwd, idx_periods_date"));

	const sessionCount = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM sessions").get();
	console.log(pico.gray(`  Existing sessions: ${sessionCount?.count ?? 0}`));

	console.log(pico.bold("\nMigration complete.\n"));
}

main();
