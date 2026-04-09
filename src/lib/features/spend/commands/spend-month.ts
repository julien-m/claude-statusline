#!/usr/bin/env bun

import { table } from "table";
import pc from "picocolors";
import { getDb } from "../index";

const pico = pc.createColors(true);

function main() {
	const db = getDb();
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const monthPrefix = `${year}-${month}`;
	const monthName = now.toLocaleString("default", {
		month: "long",
		year: "numeric",
	});

	const dailyData = db
		.query<
			{
				date: string;
				total_cost: number;
				session_count: number;
				total_duration: number;
			},
			[string]
		>(
			`SELECT date,
				SUM(total_cost) as total_cost,
				COUNT(*) as session_count,
				SUM(duration_ms) as total_duration
			FROM sessions
			WHERE date LIKE ? || '%'
			GROUP BY date
			ORDER BY date`,
		)
		.all(monthPrefix);

	if (dailyData.length === 0) {
		console.log(pico.gray(`No sessions recorded for ${monthName}`));
		return;
	}

	type DailyRow = { date: string; total_cost: number; session_count: number; total_duration: number };

	const totalCost = dailyData.reduce((sum: number, d: DailyRow) => sum + d.total_cost, 0);
	const totalSessions = dailyData.reduce(
		(sum: number, d: DailyRow) => sum + d.session_count,
		0,
	);

	console.log(
		pico.bold(`\nSpend for ${monthName}  —  $${totalCost.toFixed(2)} total\n`),
	);

	const rows = dailyData.map((d: DailyRow) => {
		const dayOfWeek = new Date(`${d.date}T12:00:00`).toLocaleString(
			"default",
			{ weekday: "short" },
		);
		const mins = Math.floor(d.total_duration / 60000);
		const hours = Math.floor(mins / 60);
		const m = mins % 60;
		const durationStr = hours > 0 ? `${hours}h ${m}m` : `${m}m`;

		// Cost bar visualization
		const maxCost = Math.max(...dailyData.map((x: DailyRow) => x.total_cost));
		const barLength = Math.round((d.total_cost / maxCost) * 20);
		const bar = "█".repeat(barLength);

		return [
			pico.gray(dayOfWeek),
			d.date,
			`$${d.total_cost.toFixed(2)}`,
			`${d.session_count}`,
			durationStr,
			pico.cyan(bar),
		];
	});

	const avgCost = totalCost / dailyData.length;
	rows.push([
		"",
		pico.bold("TOTAL"),
		pico.bold(`$${totalCost.toFixed(2)}`),
		`${totalSessions}`,
		"",
		pico.gray(`avg $${avgCost.toFixed(2)}/day`),
	]);

	const output = table(
		[
			[
				pico.gray("Day"),
				pico.gray("Date"),
				pico.gray("Cost"),
				pico.gray("Sessions"),
				pico.gray("Duration"),
				pico.gray(""),
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
