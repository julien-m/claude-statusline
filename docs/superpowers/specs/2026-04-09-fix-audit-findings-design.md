# Design: Fix Audit Findings (21 issues)

**Date:** 2026-04-09  
**Source:** Audit run 1 — `~/.claude/audits/257ecb976f7a-1.md`  
**Scope:** All findings except code-9 (uncertain/acceptable), code-13 (false positive), code-19 (uncertain/complex)

---

## Architecture

No structural changes to the module layout. All fixes are localized to existing files. One rename: `utils.ts` → `period.ts`. One migration: `index.ts` switches from legacy `renderStatusline` to `renderStatuslineRaw`.

---

## Task 1 — index.ts (code-1, code-3, code-21)

### code-1: Replace `any` with typed optionals

The six module-level `any` variables become typed using `typeof` of the actual imported functions:

```ts
type GetUsageLimits = typeof import("./lib/features/limits").getUsageLimits;
type NormalizeResetsAt = typeof import("./lib/utils").normalizeResetsAt;
type GetPeriodCost = typeof import("./lib/features/spend").getPeriodCost;
type GetWeekCost = typeof import("./lib/features/spend").getWeekCost;
type SaveSessionV2 = typeof import("./lib/features/spend").saveSessionV2;
type GetDailyTokens = typeof import("./lib/features/spend").getDailyTokens;

let getUsageLimits: GetUsageLimits | null = null;
// etc.
```

### code-3: Replace inline anonymous type with `UsageLimitsResult`

Import `UsageLimitsResult` from `./lib/features/limits` and use it for the `usageLimits` variable.

### code-21: Switch to `renderStatuslineRaw`

`index.ts` currently constructs a `StatuslineData` with a pre-formatted branch string, which `renderStatusline` then reverse-parses via `parseGitFromBranch`. Fix: build `RawStatuslineData` directly and call `renderStatuslineRaw`.

Add a mapper in `index.ts`:
```ts
function gitStatusToRawGit(git: GitStatus): RawGitData {
  return {
    branch: git.branch,
    dirty: git.hasChanges,
    staged: git.staged,
    unstaged: git.unstaged,
  };
}
```

Then pass `git: gitStatusToRawGit(gitResult)` directly to `RawStatuslineData`.  
Remove `formatBranch` call from the data construction.  
Keep `renderStatusline` and `parseGitFromBranch` in render-pure.ts for now (they may be used by tests).

---

## Task 2 — Test file (code-2)

`__tests__/statusline.test.ts` imports from `src/lib/config` which doesn't exist. The test was written for a planned config API that was never implemented.

Rewrite the file to test `renderStatuslineRaw` (modern API) with `RawStatuslineData`. Test cases cover:
- Branch name appears in output
- Model name appears in output  
- Context percentage appears
- Usage limits appear when provided
- Session cost appears
- Output contains newline (two-line format)
- Missing optional fields don't crash

Remove all config-dependent test cases (showSonnetModel, separator, oneLine — these are unimplemented features).

---

## Task 3 — render-pure.ts (code-4, code-11, code-12)

### code-4: Remove dead conditional
```ts
// Before:
if (!isSonnet || true) { // always show model

// After: (remove the if, keep the block contents)
if (data.contextWindowSize) { ... }
line1Parts.push(modelDisplay);
```

### code-11: Hoist `tokenCostPct`
Extract to module-level helper above `formatTokenBreakdownPart`:
```ts
function tokenCostPct(tokens: number, pricePerMTok: number, totalCost: number): number {
  if (totalCost <= 0) return 0;
  return Math.round((tokens * pricePerMTok) / 1_000_000 / totalCost * 100);
}
```

### code-12: Hoist `TOKEN_PRICES`
Move to module-level (joins `SEP`, `MAX_CONTEXT_TOKENS`, etc.):
```ts
const TOKEN_PRICES = {
  input: 3,
  output: 15,
  cacheWrite: 3.75,
  cacheRead: 0.30,
} as const;
```

---

## Task 4 — Spend commands (code-5, code-6, code-14, code-17)

### code-5/6: Explicit types on reduce/map

In `spend-month.ts` and `spend-project.ts`, the `dailyData` array is typed by the `.query<T>()` generic. The parameters in `.reduce()` / `.map()` callbacks need explicit types:
```ts
// The query result type is inferred from the generic — extract it:
type DailyRow = { date: string; total_cost: number; session_count: number; total_duration: number };
const totalCost = dailyData.reduce((sum: number, d: DailyRow) => sum + d.total_cost, 0);
```

### code-14: Consolidate pacing color logic

`weekly-analysis.ts` has `formatDelta` with inverted color semantics vs render-pure.ts.  
Both files have `pacingDelta` and `formatDelta` functions.  
Fix: keep them self-contained in their respective files (they serve different display contexts — weekly-analysis is a standalone CLI tool, render-pure is the statusline renderer). But standardize the color semantics: ahead of pace (positive delta) = danger = **red**, behind pace = safe = **green**. Update `weekly-analysis.ts` to match this consistent semantic.

### code-17: Fix DDL duplication in migrate-to-sqlite.ts

Replace the inline `CREATE TABLE` DDL blocks with a call to `getDb()` from `"../index"`. The migration script should use the authoritative schema source:
```ts
import { getDb } from "../index";
// In main(): const db = getDb(); // creates tables via authoritative DDL
```

---

## Task 5 — Structural (code-8, code-10, code-15, code-16, code-20)

### code-8: Add comment to empty catch

In `src/lib/context.ts:49`:
```ts
} catch {
  // skip malformed or non-JSON JSONL lines
}
```

### code-10: Rename utils.ts → period.ts

- Rename file to `src/lib/period.ts`
- Update import in `src/index.ts`: `"./lib/utils"` → `"./lib/period"`
- Update the type alias in Task 1: `NormalizeResetsAt` import path

### code-15: Export `setDb()` from spend/index.ts

Add alongside `getDb()`:
```ts
export function setDb(db: Database): void {
  _db = db;
}
```
Also export `resetDb()` for test teardown:
```ts
export function resetDb(): void {
  _db?.close();
  _db = null;
}
```

### code-16: Fix daily-tokens.test.ts to use production code paths

With `setDb()` available, rewrite tests to:
1. Create an in-memory database: `const testDb = new Database(":memory:")`
2. Call `setDb(testDb)` before tests
3. Call `resetDb()` in afterEach
4. Call actual `upsertDailyTokens()` and `getDailyTokens()` functions

### code-20: Fix fragile path traversal

In `src/lib/features/spend/index.ts`, replace:
```ts
const DATA_DIR = join(import.meta.dir, "..", "..", "..", "..", "data");
```
with a comment explaining the traversal:
```ts
// data/ is at project root: src/lib/features/spend/ → ../../../../data/
const DATA_DIR = join(import.meta.dir, "..", "..", "..", "..", "data");
```
This is a documentation fix — the path is correct, just not self-documenting. A proper refactor (centralized DATA_DIR) would require passing it through the call chain, which is out of scope for this task.

---

## Task 6 — Boundary validation (code-7, code-18)

### code-7: Type guard for OAuth API response

In `src/lib/features/limits/index.ts`, add a type guard after `response.json()`:
```ts
interface OAuthUsageData {
  five_hour?: { utilization?: number; resets_at?: string | null };
  seven_day?: { utilization?: number; resets_at?: string | null };
}

function isOAuthUsageData(data: unknown): data is OAuthUsageData {
  return typeof data === "object" && data !== null;
}
```

### code-18: Type guard for ccusage CLI output

In `src/lib/features/spend/commands/sync-daily-tokens.ts`, add shape checks after `JSON.parse`:
```ts
function isCcusageDailyResponse(data: unknown): data is CcusageDailyResponse {
  return (
    typeof data === "object" &&
    data !== null &&
    "daily" in data &&
    Array.isArray((data as CcusageDailyResponse).daily)
  );
}
```

---

## Skipped

| Finding | Reason |
|---|---|
| code-9 (OAuth token leak) | Uncertain — pattern is standard, token is scoped to try block |
| code-13 (FIVE_HOUR_MINUTES unused) | False positive — `FIVE_HOUR_MINUTES` used on line 84 |
| code-19 (no git timeout) | Uncertain — Bun `$` has no native timeout, Promise.race adds complexity |

---

## Files Modified

| File | Findings fixed |
|---|---|
| `src/index.ts` | code-1, code-3, code-21 |
| `__tests__/statusline.test.ts` | code-2 |
| `src/lib/render-pure.ts` | code-4, code-11, code-12 |
| `src/lib/features/spend/commands/spend-month.ts` | code-5 |
| `src/lib/features/spend/commands/spend-project.ts` | code-6 |
| `src/lib/features/limits/index.ts` | code-7 |
| `src/lib/context.ts` | code-8 |
| `src/lib/utils.ts` → `src/lib/period.ts` | code-10 |
| `src/lib/features/limits/commands/weekly-analysis.ts` | code-14 |
| `src/lib/features/spend/index.ts` | code-15, code-20 |
| `src/tests/daily-tokens.test.ts` | code-16 |
| `src/lib/features/spend/commands/migrate-to-sqlite.ts` | code-17 |
| `src/lib/features/spend/commands/sync-daily-tokens.ts` | code-18 |
