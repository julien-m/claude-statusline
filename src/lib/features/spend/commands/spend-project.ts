#!/usr/bin/env bun

import pc from "picocolors";
import { table } from "table";
import { getDb } from "../index";

const pico = pc.createColors(true);

function main() {
	const db = getDb();

	const projects = db
		.query<
			{
				cwd: string;
				total_cost: number;
				session_count: number;
				total_duration: number;
				total_added: number;
				total_removed: number;
				first_date: string;
				last_date: string;
			},
			[]
		>(
			`SELECT cwd,
				SUM(total_cost) as total_cost,
				COUNT(*) as session_count,
				SUM(duration_ms) as total_duration,
				SUM(lines_added) as total_added,
				SUM(lines_removed) as total_removed,
				MIN(date) as first_date,
				MAX(date) as last_date
			FROM sessions
			GROUP BY cwd
			ORDER BY total_cost DESC`,
		)
		.all();

	if (projects.length === 0) {
		console.log(pico.gray("No sessions recorded yet"));
		return;
	}

	type ProjectRow = {
		cwd: string;
		total_cost: number;
		session_count: number;
		total_duration: number;
		total_added: number;
		total_removed: number;
		first_date: string;
		last_date: string;
	};

	const grandTotal = projects.reduce(
		(sum: number, p: ProjectRow) => sum + p.total_cost,
		0,
	);

	console.log(
		pico.bold(
			`\nSpend by project  —  $${grandTotal.toFixed(2)} total across ${projects.length} projects\n`,
		),
	);

	const rows = projects.map((p: ProjectRow) => {
		const projectName = p.cwd.replace(/^.*\//, "");
		const mins = Math.floor(p.total_duration / 60000);
		const hours = Math.floor(mins / 60);
		const m = mins % 60;
		const durationStr = hours > 0 ? `${hours}h ${m}m` : `${m}m`;
		const pct = ((p.total_cost / grandTotal) * 100).toFixed(0);

		return [
			pico.bold(projectName),
			`$${p.total_cost.toFixed(2)}`,
			`${pct}%`,
			`${p.session_count}`,
			durationStr,
			p.total_added > 0 ? pico.green(`+${p.total_added}`) : pico.gray("-"),
			p.total_removed > 0 ? pico.red(`-${p.total_removed}`) : pico.gray("-"),
			pico.gray(`${p.first_date} → ${p.last_date}`),
		];
	});

	const output = table(
		[
			[
				pico.gray("Project"),
				pico.gray("Cost"),
				pico.gray("%"),
				pico.gray("Sessions"),
				pico.gray("Duration"),
				pico.gray("Added"),
				pico.gray("Removed"),
				pico.gray("Period"),
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
