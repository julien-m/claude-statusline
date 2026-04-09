#!/usr/bin/env bun

import { table } from "table";
import pc from "picocolors";
import { getDb } from "../index";

const pico = pc.createColors(true);

function main() {
	const db = getDb();
	const today = new Date().toISOString().split("T")[0];

	const sessions = db
		.query<
			{
				session_id: string;
				total_cost: number;
				cwd: string;
				duration_ms: number;
				lines_added: number;
				lines_removed: number;
			},
			[string]
		>(
			"SELECT session_id, total_cost, cwd, duration_ms, lines_added, lines_removed FROM sessions WHERE date = ? ORDER BY total_cost DESC",
		)
		.all(today);

	if (sessions.length === 0) {
		console.log(pico.gray(`No sessions recorded for ${today}`));
		return;
	}

	const totalCost = sessions.reduce((sum, s) => sum + s.total_cost, 0);
	const totalDuration = sessions.reduce((sum, s) => sum + s.duration_ms, 0);
	const totalAdded = sessions.reduce((sum, s) => sum + s.lines_added, 0);
	const totalRemoved = sessions.reduce((sum, s) => sum + s.lines_removed, 0);

	console.log(
		pico.bold(`\nSpend for ${today}  —  $${totalCost.toFixed(2)} total\n`),
	);

	const rows = sessions.map((s) => {
		const mins = Math.floor(s.duration_ms / 60000);
		const shortId = s.session_id.slice(0, 8);
		const project = s.cwd.replace(/^.*\//, "");

		return [
			pico.gray(shortId),
			project,
			`$${s.total_cost.toFixed(2)}`,
			`${mins}m`,
			s.lines_added > 0 ? pico.green(`+${s.lines_added}`) : pico.gray("-"),
			s.lines_removed > 0
				? pico.red(`-${s.lines_removed}`)
				: pico.gray("-"),
		];
	});

	const totalMins = Math.floor(totalDuration / 60000);
	const hours = Math.floor(totalMins / 60);
	const mins = totalMins % 60;
	const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

	rows.push([
		pico.bold("TOTAL"),
		pico.gray(`${sessions.length} sessions`),
		pico.bold(`$${totalCost.toFixed(2)}`),
		durationStr,
		totalAdded > 0 ? pico.green(`+${totalAdded}`) : "-",
		totalRemoved > 0 ? pico.red(`-${totalRemoved}`) : "-",
	]);

	const output = table(
		[
			[
				pico.gray("Session"),
				pico.gray("Project"),
				pico.gray("Cost"),
				pico.gray("Duration"),
				pico.gray("Added"),
				pico.gray("Removed"),
			],
			...rows,
		],
		{
			border: {
				topBody: "─",
				topJoin: "┬",
				topLeft: "┌",
				topRight: "┐",
				bottomBody: "─",
				bottomJoin: "┴",
				bottomLeft: "└",
				bottomRight: "┘",
				bodyLeft: "│",
				bodyRight: "│",
				bodyJoin: "│",
				joinBody: "─",
				joinLeft: "├",
				joinRight: "┤",
				joinJoin: "┼",
			},
		},
	);

	console.log(output);
}

main();
