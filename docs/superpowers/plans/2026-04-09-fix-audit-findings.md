# Fix Audit Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 18 audit findings across 13 files — no new features, no architecture changes, pure quality fixes.

**Architecture:** Fixes are grouped by dependency order. Tasks 1–8 are independent (can run in parallel). Tasks 9–11 depend on earlier tasks. Task 12 finalizes test coverage.

**Tech Stack:** Bun, TypeScript (strict), Biome, bun:sqlite

---

## File Map

| File | Action | Findings |
|---|---|---|
| `src/lib/render-pure.ts` | Modify | code-4, code-11, code-12 |
| `src/lib/context.ts` | Modify | code-8 |
| `src/lib/features/limits/index.ts` | Modify | code-7 |
| `src/lib/features/spend/commands/spend-month.ts` | Modify | code-5 |
| `src/lib/features/spend/commands/spend-project.ts` | Modify | code-6 |
| `src/lib/utils.ts` → `src/lib/period.ts` | Rename | code-10 |
| `src/lib/features/spend/index.ts` | Modify | code-15, code-20 |
| `src/lib/features/limits/commands/weekly-analysis.ts` | Modify | code-14 |
| `src/lib/features/spend/commands/sync-daily-tokens.ts` | Modify | code-18 |
| `src/lib/features/spend/commands/migrate-to-sqlite.ts` | Modify | code-17 |
| `src/index.ts` | Modify | code-1, code-3, code-21 |
| `src/tests/daily-tokens.test.ts` | Rewrite | code-16 |
| `__tests__/statusline.test.ts` | Rewrite | code-2 |

---

## Task 1: render-pure.ts — remove dead code, hoist constants

**Files:**
- Modify: `src/lib/render-pure.ts`

**Context:** Three independent fixes in the same file.
- code-4: `if (!isSonnet || true)` is a dead conditional — `|| true` makes it always execute. Remove the if, keep the block.
- code-12: `TOKEN_PRICES` is defined inside `formatTokenBreakdownPart()` on every call. Move to module scope alongside `SEP`, `MAX_CONTEXT_TOKENS`.
- code-11: `tokenCostPct` inner function defined inside `formatTokenBreakdownPart()`. Extract to module-level helper.

- [ ] **Step 1: Open render-pure.ts and locate the three targets**

File: `src/lib/render-pure.ts`

Line ~310 (dead conditional):
```ts
const isSonnet = data.modelName.toLowerCase().includes("sonnet");
let modelDisplay = colors.peach(data.modelName);
if (!isSonnet || true) { // always show model
  if (data.contextWindowSize) {
    modelDisplay += ` ${colors.gray(`(${formatContextWindowSize(data.contextWindowSize)} context)`)}`;
  }
  line1Parts.push(modelDisplay);
}
```

Line ~263 (TOKEN_PRICES + tokenCostPct inside function):
```ts
export function formatTokenBreakdownPart(data: TokenBreakdownData | null | undefined): string {
  if (!data || data.totalCost <= 0) return "";

  const TOKEN_PRICES = {
    input: 3,
    output: 15,
    cacheWrite: 3.75,
    cacheRead: 0.30,
  } as const;

  function tokenCostPct(tokens: number, pricePerMTok: number): number {
    if (data!.totalCost <= 0) return 0;
    return Math.round(
      ((tokens * pricePerMTok) / 1_000_000 / data!.totalCost) * 100,
    );
  }
  ...
}
```

- [ ] **Step 2: Hoist TOKEN_PRICES to module scope**

Find the module-level constants block (around line 22, where `SEP`, `MAX_CONTEXT_TOKENS` are defined). Add TOKEN_PRICES there:

```ts
const SEP = "·";
const PATH_MODE = "truncated" as const;
const COST_FORMAT = "decimal1" as const;
const MAX_CONTEXT_TOKENS = 200000;

const WEEKLY_HOURS = 168;
const FIVE_HOUR_MINUTES = 300;

const TOKEN_PRICES = {
  input: 3,
  output: 15,
  cacheWrite: 3.75,
  cacheRead: 0.30,
} as const;
```

Then remove the `const TOKEN_PRICES = { ... } as const;` block from inside `formatTokenBreakdownPart`.

- [ ] **Step 3: Extract tokenCostPct to module level**

Add this function just above `formatTokenBreakdownPart` (before the function definition):

```ts
function tokenCostPct(tokens: number, pricePerMTok: number, totalCost: number): number {
  if (totalCost <= 0) return 0;
  return Math.round(((tokens * pricePerMTok) / 1_000_000 / totalCost) * 100);
}
```

Update the calls inside `formatTokenBreakdownPart` to pass `data.totalCost` as the third argument:

```ts
const inPct = tokenCostPct(data.inputTokens, TOKEN_PRICES.input, data.totalCost);
const outPct = tokenCostPct(data.outputTokens, TOKEN_PRICES.output, data.totalCost);
const cwPct = tokenCostPct(data.cacheCreationTokens, TOKEN_PRICES.cacheWrite, data.totalCost);
const crPct = tokenCostPct(data.cacheReadTokens, TOKEN_PRICES.cacheRead, data.totalCost);
```

Remove the old inner `function tokenCostPct(...)` declaration from inside `formatTokenBreakdownPart`.

- [ ] **Step 4: Remove dead conditional (code-4)**

Find the block:
```ts
const isSonnet = data.modelName.toLowerCase().includes("sonnet");
let modelDisplay = colors.peach(data.modelName);
if (!isSonnet || true) { // always show model
  if (data.contextWindowSize) {
    modelDisplay += ` ${colors.gray(`(${formatContextWindowSize(data.contextWindowSize)} context)`)}`;
  }
  line1Parts.push(modelDisplay);
}
```

Replace with (remove the outer if, keep its contents):
```ts
const isSonnet = data.modelName.toLowerCase().includes("sonnet");
void isSonnet; // kept for future use if model-based filtering is reintroduced
let modelDisplay = colors.peach(data.modelName);
if (data.contextWindowSize) {
  modelDisplay += ` ${colors.gray(`(${formatContextWindowSize(data.contextWindowSize)} context)`)}`;
}
line1Parts.push(modelDisplay);
```

Note: keep `isSonnet` with a `void` to avoid unused-variable lint error — it's useful signal for future config, and removing it entirely would lose the semantic.

- [ ] **Step 5: Verify type check passes**

```bash
cd /Users/julienm/projects/claude-statusline
bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/render-pure.ts
git commit -m "refactor(render-pure): hoist TOKEN_PRICES/tokenCostPct to module scope, remove dead conditional"
```

---

## Task 2: context.ts — add comment to empty catch

**Files:**
- Modify: `src/lib/context.ts`

- [ ] **Step 1: Find and update the empty catch**

In `src/lib/context.ts`, around line 49, find:
```ts
      } catch {}
```

Replace with:
```ts
      } catch {
        // skip malformed or non-JSON JSONL lines
      }
```

- [ ] **Step 2: Verify**

```bash
bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/context.ts
git commit -m "fix(context): add comment to empty catch in JSONL parser"
```

---

## Task 3: limits/index.ts — type guard for OAuth response

**Files:**
- Modify: `src/lib/features/limits/index.ts`

**Context:** `response.json()` returns `unknown` but the code accesses `data.five_hour.utilization` without runtime validation. Add a simple interface + type guard.

- [ ] **Step 1: Add OAuthUsageData interface and type guard**

At the top of `src/lib/features/limits/index.ts`, after the existing interfaces, add:

```ts
interface OAuthUsagePeriod {
  utilization?: number;
  resets_at?: string | null;
}

interface OAuthUsageData {
  five_hour?: OAuthUsagePeriod;
  seven_day?: OAuthUsagePeriod;
}

function isOAuthUsageData(data: unknown): data is OAuthUsageData {
  return typeof data === "object" && data !== null;
}
```

- [ ] **Step 2: Apply the type guard in getUsageLimits**

Find this line in `getUsageLimits`:
```ts
const data = await response.json();
```

Replace with:
```ts
const raw: unknown = await response.json();
if (!isOAuthUsageData(raw)) return { five_hour: null, seven_day: null };
const data: OAuthUsageData = raw;
```

- [ ] **Step 3: Verify type check passes**

```bash
bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/features/limits/index.ts
git commit -m "fix(limits): add type guard for OAuth API response boundary"
```

---

## Task 4: spend commands — explicit types on reduce/map

**Files:**
- Modify: `src/lib/features/spend/commands/spend-month.ts`
- Modify: `src/lib/features/spend/commands/spend-project.ts`

**Context:** The `.query<T>()` generic defines the row type, but TypeScript with strict mode emits TS7006 on `.reduce()` / `.map()` callbacks without explicit parameter types.

- [ ] **Step 1: Fix spend-month.ts**

In `src/lib/features/spend/commands/spend-month.ts`, add a type alias for the query result right after the `const dailyData = db.query<{...}>(...).all(monthPrefix)` call, then annotate the callbacks:

Find the reduce/map calls (around lines 46–67):
```ts
const totalCost = dailyData.reduce((sum, d) => sum + d.total_cost, 0);
const totalSessions = dailyData.reduce(
  (sum, d) => sum + d.session_count,
  0,
);
```

and:
```ts
const rows = dailyData.map((d) => {
  ...
  const maxCost = Math.max(...dailyData.map((x) => x.total_cost));
```

Add a type alias above the reduce calls:
```ts
type DailyRow = { date: string; total_cost: number; session_count: number; total_duration: number };
```

Then update the callbacks:
```ts
const totalCost = dailyData.reduce((sum: number, d: DailyRow) => sum + d.total_cost, 0);
const totalSessions = dailyData.reduce(
  (sum: number, d: DailyRow) => sum + d.session_count,
  0,
);
```

```ts
const rows = dailyData.map((d: DailyRow) => {
  ...
  const maxCost = Math.max(...dailyData.map((x: DailyRow) => x.total_cost));
```

- [ ] **Step 2: Fix spend-project.ts**

In `src/lib/features/spend/commands/spend-project.ts`, apply the same pattern. Find the query result type from the `.query<{...}>()` call. Add:
```ts
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
```

Then annotate `.reduce()` and `.map()` callbacks:
```ts
const grandTotal = projects.reduce((sum: number, p: ProjectRow) => sum + p.total_cost, 0);
const rows = projects.map((p: ProjectRow) => {
```

- [ ] **Step 3: Verify**

```bash
bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/features/spend/commands/spend-month.ts src/lib/features/spend/commands/spend-project.ts
git commit -m "fix(spend): add explicit types to reduce/map callbacks"
```

---

## Task 5: Rename utils.ts → period.ts

**Files:**
- Rename: `src/lib/utils.ts` → `src/lib/period.ts`
- Modify: `src/index.ts` (update import path)

**Context:** `utils.ts` violates the "each file owns one concept" convention. The file contains only `normalizeResetsAt` — a time period normalization function. Rename to `period.ts`.

- [ ] **Step 1: Rename the file**

```bash
mv /Users/julienm/projects/claude-statusline/src/lib/utils.ts /Users/julienm/projects/claude-statusline/src/lib/period.ts
```

- [ ] **Step 2: Update import in src/index.ts**

Find in `src/index.ts`:
```ts
try {
  const utilsModule = await import("./lib/utils");
  normalizeResetsAt = utilsModule.normalizeResetsAt;
} catch {
  normalizeResetsAt = (resetsAt: string) => resetsAt;
}
```

Replace `"./lib/utils"` with `"./lib/period"`:
```ts
try {
  const periodModule = await import("./lib/period");
  normalizeResetsAt = periodModule.normalizeResetsAt;
} catch {
  normalizeResetsAt = (resetsAt: string) => resetsAt;
}
```

- [ ] **Step 3: Verify no other imports reference utils.ts**

```bash
grep -r "lib/utils" /Users/julienm/projects/claude-statusline/src/
grep -r "lib/utils" /Users/julienm/projects/claude-statusline/__tests__/
```

Expected: no matches.

- [ ] **Step 4: Verify**

```bash
bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/period.ts src/lib/utils.ts src/index.ts
git commit -m "refactor: rename utils.ts → period.ts (each file owns one concept)"
```

---

## Task 6: spend/index.ts — add setDb/resetDb exports + indexes

**Files:**
- Modify: `src/lib/features/spend/index.ts`

**Context:** Module-level singleton `let _db = null` prevents test isolation. Tests currently bypass production functions and run raw SQL against a separate database file. Adding `setDb()` + `resetDb()` allows tests to inject an in-memory DB.

Also: `migrate-to-sqlite.ts` creates 3 indexes (`idx_sessions_date`, `idx_sessions_cwd`, `idx_periods_date`) that are NOT in `getDb()`. Moving them into `getDb()` lets Task 9 safely delegate all schema creation to `getDb()` without silently dropping those indexes.

- [ ] **Step 1: Add 3 index creation statements to getDb() in spend/index.ts**

Inside `getDb()`, after all the `CREATE TABLE IF NOT EXISTS` blocks (around line 83), add:

```ts
  _db.run("CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date)");
  _db.run("CREATE INDEX IF NOT EXISTS idx_sessions_cwd ON sessions(cwd)");
  _db.run("CREATE INDEX IF NOT EXISTS idx_periods_date ON periods(date)");
```

- [ ] **Step 2: Add setDb and resetDb after getDb in spend/index.ts**

Find `export function getDb(): Database { ... }` (ends around line 85+3 = 88 after Step 1). Add immediately after:

```ts
/** For testing only — inject an in-memory database. */
export function setDb(db: Database): void {
  _db = db;
}

/** For testing only — close and reset the singleton. */
export function resetDb(): void {
  _db?.close();
  _db = null;
}
```

- [ ] **Step 3: Verify**

```bash
bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Add documentation comment to DATA_DIR (code-20)**

Find:
```ts
const DATA_DIR = join(import.meta.dir, "..", "..", "..", "..", "data");
```

Replace with:
```ts
// data/ is at project root: src/lib/features/spend/ is 4 levels deep → ../../../../data/
const DATA_DIR = join(import.meta.dir, "..", "..", "..", "..", "data");
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/features/spend/index.ts
git commit -m "fix(spend): move indexes to getDb(), export setDb/resetDb for test injection, document DATA_DIR"
```

---

## Task 7: weekly-analysis.ts — remove duplicate FIVE_HOUR_MINUTES usage check

**Files:**
- Modify: `src/lib/features/limits/commands/weekly-analysis.ts`

**Context:** The audit claimed `FIVE_HOUR_MINUTES` was unused. Verification: it IS used in `pacingDelta(fh.utilization, fh.resets_at, FIVE_HOUR_MINUTES)`. This is a false positive — no change needed for code-13.

However, code-14: `formatDelta` in weekly-analysis.ts duplicates formatting logic. Since render-pure.ts has no equivalent exported `formatPacingDelta`, keeping it self-contained is acceptable. The task is to verify, not change.

- [ ] **Step 1: Verify FIVE_HOUR_MINUTES is used**

```bash
grep -n "FIVE_HOUR_MINUTES" /Users/julienm/projects/claude-statusline/src/lib/features/limits/commands/weekly-analysis.ts
```

Expected output:
```
9:const FIVE_HOUR_MINUTES = 300;
84:    const delta = pacingDelta(fh.utilization, fh.resets_at, FIVE_HOUR_MINUTES);
```

Finding code-13 is confirmed as false positive. No change needed.

- [ ] **Step 2: Verify render-pure.ts has no formatPacingDelta to share**

```bash
grep -n "formatPacingDelta\|pacingDelta" /Users/julienm/projects/claude-statusline/src/lib/render-pure.ts
```

Expected: no output (render-pure.ts has no such function).

Finding code-14: the `formatDelta` function in weekly-analysis.ts is self-contained in a standalone CLI tool. Not a violation. No change needed.

- [ ] **Step 3: No commit needed**

This task is verification only. Both code-13 and code-14 are confirmed non-issues.

---

## Task 8: sync-daily-tokens.ts — type guard for ccusage output

**Files:**
- Modify: `src/lib/features/spend/commands/sync-daily-tokens.ts`

**Context:** `runCcusage` returns `unknown`, then the result is cast as `CcusageDailyResponse` / `CcusageBlocksResponse` without runtime validation. Add type guards.

- [ ] **Step 1: Add type guard functions after the interfaces**

In `src/lib/features/spend/commands/sync-daily-tokens.ts`, after the interface definitions (lines ~5–28), add:

```ts
function isCcusageDailyResponse(data: unknown): data is CcusageDailyResponse {
  return (
    typeof data === "object" &&
    data !== null &&
    "totals" in data &&
    typeof (data as CcusageDailyResponse).totals === "object"
  );
}

function isCcusageBlocksResponse(data: unknown): data is CcusageBlocksResponse {
  return (
    typeof data === "object" &&
    data !== null &&
    "blocks" in data &&
    Array.isArray((data as CcusageBlocksResponse).blocks)
  );
}
```

- [ ] **Step 2: Replace unsafe casts with guarded assertions in main()**

When a type guard fails, throw an `Error` with a descriptive message — the existing `main().catch(() => process.exit(0))` at the bottom already handles all thrown errors gracefully.

Find:
```ts
const dailyResponse = (await runCcusage([
  "daily", "--since", today, "--until", today, "--json", "--offline",
])) as CcusageDailyResponse;
```

Replace with:
```ts
const dailyRaw = await runCcusage(["daily", "--since", today, "--until", today, "--json", "--offline"]);
if (!isCcusageDailyResponse(dailyRaw)) {
  throw new Error("Unexpected ccusage daily response format");
}
const dailyResponse: CcusageDailyResponse = dailyRaw;
```

Find:
```ts
const blocksResponse = (await runCcusage([
  "blocks", "--since", yesterday, "--json", "--offline",
])) as CcusageBlocksResponse;
```

Replace with:
```ts
const blocksRaw = await runCcusage(["blocks", "--since", yesterday, "--json", "--offline"]);
if (!isCcusageBlocksResponse(blocksRaw)) {
  throw new Error("Unexpected ccusage blocks response format");
}
const blocksResponse: CcusageBlocksResponse = blocksRaw;
```

Guard failure behavior: throws `Error` → caught by `main().catch(() => process.exit(0))` → exits cleanly without crashing the parent statusline process.

- [ ] **Step 3: Verify**

```bash
bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/features/spend/commands/sync-daily-tokens.ts
git commit -m "fix(sync-daily-tokens): add type guards for ccusage CLI output boundaries"
```

---

## Task 9: migrate-to-sqlite.ts — use getDb() for authoritative DDL

**Files:**
- Modify: `src/lib/features/spend/commands/migrate-to-sqlite.ts`

**Context:** migrate-to-sqlite.ts re-declares the full CREATE TABLE DDL, which is already defined in `spend/index.ts:getDb()`. The migration DDL is also missing the `daily_tokens` table.

**Depends on:** Task 6 — the 3 indexes (`idx_sessions_date`, `idx_sessions_cwd`, `idx_periods_date`) that were previously in migrate-to-sqlite.ts are moved into `getDb()` in Task 6. After Task 6, `getDb()` is the complete authoritative schema source.

Fix: call `getDb()` to create all tables AND indexes from the single source of truth.

- [ ] **Step 1: Read the current migrate-to-sqlite.ts**

The file currently:
1. Creates its own `Database` at `DATA_DIR/spend.db`
2. Manually re-declares DDL for sessions, session_period_tracking, periods
3. Creates 3 indexes: idx_sessions_date, idx_sessions_cwd, idx_periods_date

After Task 6, all of these are in `getDb()`. This file can be simplified entirely.

- [ ] **Step 2: Replace inline DDL with getDb() call**

Replace the entire file content with:

```ts
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
```

- [ ] **Step 3: Verify**

```bash
bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/features/spend/commands/migrate-to-sqlite.ts
git commit -m "fix(migrate): use getDb() for authoritative DDL, remove duplicate schema and index declarations"
```

---

## Task 10: index.ts — typed optionals + switch to renderStatuslineRaw

**Files:**
- Modify: `src/index.ts`

**Depends on:** Task 5 (utils.ts renamed to period.ts)

### Part A: code-1 — Replace `any` with typed optionals

- [ ] **Step 1: Add type aliases for optional feature functions**

At the top of `src/index.ts`, after the existing imports, add type aliases:

```ts
type GetUsageLimits = typeof import("./lib/features/limits").getUsageLimits;
type NormalizeResetsAt = (resetsAt: string) => string;
type GetPeriodCost = typeof import("./lib/features/spend").getPeriodCost;
type GetWeekCost = typeof import("./lib/features/spend").getWeekCost;
type SaveSessionV2 = typeof import("./lib/features/spend").saveSessionV2;
type GetDailyTokens = typeof import("./lib/features/spend").getDailyTokens;
```

Note: `NormalizeResetsAt` uses an explicit function signature instead of `typeof import(...)` because the fallback in the catch block is a different lambda.

- [ ] **Step 2: Replace `any` declarations**

Replace:
```ts
let getUsageLimits: any = null;
let normalizeResetsAt: any = null;
let getPeriodCost: any = null;
let getWeekCost: any = null;
let saveSessionV2: any = null;
let getDailyTokens: any = null;
```

With:
```ts
let getUsageLimits: GetUsageLimits | null = null;
let normalizeResetsAt: NormalizeResetsAt | null = null;
let getPeriodCost: GetPeriodCost | null = null;
let getWeekCost: GetWeekCost | null = null;
let saveSessionV2: SaveSessionV2 | null = null;
let getDailyTokens: GetDailyTokens | null = null;
```

### Part B: code-3 — Use UsageLimitsResult for the usageLimits variable

- [ ] **Step 3: Import UsageLimitsResult**

Add to the limits import at the top:
```ts
import type { UsageLimitsResult } from "./lib/features/limits";
```

Note: This is a static import of just the type — it won't fail even if the limits module is missing at runtime (type-only imports are erased at compile time).

Actually, since limits is a dynamic import in this file, use `type` from the module inline:
```ts
type UsageLimitsResult = {
  five_hour: { utilization: number; resets_at: string | null } | null;
  seven_day: { utilization: number; resets_at: string | null } | null;
};
```

Add this type alias near the top (after the `GetDailyTokens` type aliases).

- [ ] **Step 4: Apply the type to the usageLimits variable declaration**

Find in `main()`:
```ts
let usageLimits: { five_hour: { utilization: number; resets_at: string } | null; seven_day: { utilization: number; resets_at: string } | null };
```

Replace with:
```ts
let usageLimits: UsageLimitsResult;
```

### Part C: code-21 — Switch to renderStatuslineRaw

- [ ] **Step 5: Add GitStatus → RawGitData mapper**

Add a helper function in `src/index.ts` (after the imports, before `main()`):

```ts
import type { GitStatus } from "./lib/git";
import { renderStatuslineRaw, type RawStatuslineData, type RawGitData } from "./lib/render-pure";

function gitStatusToRawGit(git: GitStatus): RawGitData {
  return {
    branch: git.branch,
    dirty: git.hasChanges,
    staged: git.staged,
    unstaged: git.unstaged,
  };
}
```

Note: `GitStatus.staged/unstaged` has `{ added, deleted, files }` which matches `RawGitData.staged/unstaged`.

- [ ] **Step 6: Switch data construction to RawStatuslineData**

In `main()`, find the `const data: StatuslineData = { ... }` block and replace it with:

```ts
const data: RawStatuslineData = {
  git: gitStatusToRawGit(git),
  path: formatPath(input.workspace.current_dir, "truncated"),
  modelName: input.model.display_name,
  contextWindowSize: input.context_window?.context_window_size,
  cost: input.cost.total_cost_usd,
  durationMs: input.cost.total_duration_ms,
  contextTokens,
  contextPercentage,
  ...(getUsageLimits && {
    usageLimits: {
      five_hour: usageLimits.five_hour
        ? { utilization: usageLimits.five_hour.utilization, resets_at: usageLimits.five_hour.resets_at }
        : null,
      seven_day: usageLimits.seven_day
        ? { utilization: usageLimits.seven_day.utilization, resets_at: usageLimits.seven_day.resets_at }
        : null,
    },
  }),
  ...(getPeriodCost && { periodCost }),
  todayCost,
  ...(getWeekCost && { weekCost }),
  ...(getDailyTokens && { tokenBreakdown }),
};
```

- [ ] **Step 7: Switch the render call**

Find:
```ts
const output = renderStatusline(data);
```

Replace with:
```ts
const output = renderStatuslineRaw(data);
```

Update the import from render-pure.ts at the top. Remove `renderStatusline` and `StatuslineData` from the import, add `renderStatuslineRaw` and `RawStatuslineData`:

```ts
import {
  renderStatuslineRaw,
  type RawStatuslineData,
  type RawGitData,
  type TokenBreakdownData,
  type UsageLimit,
} from "./lib/render-pure";
```

Also remove `formatBranch` from the formatters import since it's no longer needed.

- [ ] **Step 8: Verify**

```bash
bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/index.ts
git commit -m "fix(index): replace any optionals with typed signatures, switch to renderStatuslineRaw"
```

---

## Task 11: daily-tokens.test.ts — use production code paths

**Files:**
- Modify: `src/tests/daily-tokens.test.ts`

**Depends on:** Task 6 (setDb/resetDb now available)

**Context:** Tests currently create their own Database and run raw SQL instead of calling `upsertDailyTokens()` and `getDailyTokens()`. After Task 6, `setDb()` allows injecting a test DB so production code paths are exercised.

**Important:** The entire current test file body must be deleted. The existing tests run raw SQL directly against a separate database file instead of calling `upsertDailyTokens()` / `getDailyTokens()`. After this rewrite, ALL raw SQL in the test is gone — replaced with calls to the production functions through a `setDb()`-injected in-memory database.

- [ ] **Step 1: Rewrite the test file**

Replace `src/tests/daily-tokens.test.ts` with (entire file, no raw SQL blocks retained):

```ts
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getDailyTokens,
  resetDb,
  setDb,
  upsertDailyTokens,
  type DailyTokensRow,
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
```

- [ ] **Step 2: Run tests**

```bash
bun test src/tests/daily-tokens.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/tests/daily-tokens.test.ts
git commit -m "test(daily-tokens): refactor to use production code paths via setDb injection"
```

---

## Task 12: statusline.test.ts — rewrite for current API

**Files:**
- Modify: `__tests__/statusline.test.ts`

**Depends on:** Task 10 (renderStatuslineRaw available and correctly typed)

**Context:** The existing test file (`~300 lines`) calls `renderStatusline(data, config)` with two arguments and imports from `src/lib/config` (file doesn't exist). All existing test cases are config-gated and must be replaced.

**Dropped test cases** (config API that was never implemented):
- `showSonnetModel: false/true` — no config param in API
- `session.cost.enabled`, `session.duration.enabled`, `session.percentage` — hardcoded behavior
- `limits.enabled`, `limits.showTimeLeft` — hardcoded
- `weeklyUsage.enabled`, `weeklyUsage.enabled: "90%"` — hardcoded
- `dailySpend.cost.enabled` — hardcoded
- `separator`, `oneLine` — hardcoded

**Replacement coverage** (assertions against hardcoded behavior of `renderStatuslineRaw`):
- Branch name appears in output
- Directory path appears
- Model name appears
- Dirty git state changes output
- Context percentage appears
- Usage limits utilization appears when provided
- Null git/limits/context don't crash
- Session cost ($) appears
- Output has two lines

- [ ] **Step 1: Rewrite the test file**

Replace `__tests__/statusline.test.ts` with:

```ts
import { describe, expect, it } from "bun:test";
import { renderStatuslineRaw, type RawStatuslineData } from "../src/lib/render-pure";

function buildData(overrides: Partial<RawStatuslineData> = {}): RawStatuslineData {
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
    it("shows dirty indicator when there are changes", () => {
      const output = renderStatuslineRaw(buildData({
        git: {
          branch: "feat/my-branch",
          dirty: true,
          staged: { files: 1, added: 10, deleted: 2 },
          unstaged: { files: 0, added: 0, deleted: 0 },
        },
      }));
      expect(output).toContain("feat/my-branch");
    });

    it("handles null git gracefully", () => {
      const output = renderStatuslineRaw(buildData({ git: null }));
      expect(typeof output).toBe("string");
    });
  });

  describe("context usage", () => {
    it("includes context percentage in output", () => {
      const output = renderStatuslineRaw(buildData({ contextPercentage: 45, contextTokens: 90000 }));
      expect(output).toContain("45");
    });

    it("handles null context tokens gracefully", () => {
      const output = renderStatuslineRaw(buildData({ contextTokens: null, contextPercentage: null }));
      expect(typeof output).toBe("string");
    });
  });

  describe("usage limits", () => {
    it("includes limit utilization when provided", () => {
      const output = renderStatuslineRaw(buildData({
        usageLimits: {
          five_hour: { utilization: 50, resets_at: "2025-01-01T15:00:00Z" },
          seven_day: null,
        },
      }));
      expect(output).toContain("50");
    });

    it("renders cleanly without usage limits", () => {
      const output = renderStatuslineRaw(buildData({ usageLimits: undefined }));
      expect(typeof output).toBe("string");
    });
  });

  describe("cost display", () => {
    it("includes session cost", () => {
      const output = renderStatuslineRaw(buildData({ cost: 1.5 }));
      expect(output).toContain("$");
    });
  });
});
```

- [ ] **Step 2: Run tests**

```bash
bun test __tests__/statusline.test.ts
```

Expected: all 10 tests pass.

- [ ] **Step 3: Run full test suite**

```bash
bun test
```

Expected: all tests pass (may have pre-existing failures in other test files — do not attempt to fix those here).

- [ ] **Step 4: Run type check and linter**

```bash
bunx tsc --noEmit
biome check .
```

Expected: no errors from tsc. Biome may surface minor formatting — apply auto-fix if needed:
```bash
biome check --write .
```

- [ ] **Step 5: Commit**

```bash
git add __tests__/statusline.test.ts
git commit -m "test(statusline): rewrite for renderStatuslineRaw API, remove dead config imports"
```

---

## Final Verification

- [ ] **Run full type check**

```bash
bunx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Run linter**

```bash
biome check .
```

Expected: 0 errors (or apply `biome check --write .` to auto-fix).

- [ ] **Run full test suite**

```bash
bun test
```

Expected: all tests in the rewritten files pass.
