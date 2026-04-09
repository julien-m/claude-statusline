# Implementation Plan — Token Breakdown Feature

**Date:** 2026-04-09  
**Spec:** `docs/superpowers/specs/2026-04-09-token-breakdown-design.md`  
**Execution:** Subagent-Driven (tasks are independent where noted)

---

## Task 1 — DB: Add `daily_tokens` table + functions

**File:** `src/lib/features/spend/index.ts`  
**Dependencies:** None

### 1a. Add `DailyTokensRow` interface (top of file, after imports)

```typescript
export interface DailyTokensRow {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  blockCost: number;
  blockRemainingMin: number;
  blockProjectionCost: number;
  burnRatePerHour: number;
  totalCost: number;
  updatedAt: string;
}
```

### 1b. Add `daily_tokens` table to `getDb()`, after the `periods` table creation

```sql
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
```

### 1c. Add `upsertDailyTokens` function (after `getTodayCostV2`)

```typescript
export function upsertDailyTokens(data: DailyTokensRow): void {
  try {
    const db = getDb();
    db.run(
      `INSERT INTO daily_tokens (date, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, block_cost, block_remaining_min, block_projection_cost, burn_rate_per_hour, total_cost, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      [data.date, data.inputTokens, data.outputTokens, data.cacheCreationTokens,
       data.cacheReadTokens, data.blockCost, data.blockRemainingMin,
       data.blockProjectionCost, data.burnRatePerHour, data.totalCost, data.updatedAt]
    );
  } catch {
    // Fail silently
  }
}
```

### 1d. Add `getDailyTokens` function

```typescript
export function getDailyTokens(date: string): DailyTokensRow | null {
  try {
    const db = getDb();
    const row = db.query<{
      date: string; input_tokens: number; output_tokens: number;
      cache_creation_tokens: number; cache_read_tokens: number;
      block_cost: number; block_remaining_min: number;
      block_projection_cost: number; burn_rate_per_hour: number;
      total_cost: number; updated_at: string;
    }, [string]>(
      "SELECT * FROM daily_tokens WHERE date = ?"
    ).get(date);
    if (!row) return null;
    return {
      date: row.date,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheCreationTokens: row.cache_creation_tokens,
      cacheReadTokens: row.cache_read_tokens,
      blockCost: row.block_cost,
      blockRemainingMin: row.block_remaining_min,
      blockProjectionCost: row.block_projection_cost,
      burnRatePerHour: row.burn_rate_per_hour,
      totalCost: row.total_cost,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}
```

---

## Task 2 — Sync Script

**File:** `src/lib/features/spend/commands/sync-daily-tokens.ts` (create new)  
**Dependencies:** Task 1 complete

```typescript
#!/usr/bin/env bun

import { upsertDailyTokens } from "../index.ts";

async function runCcusage(args: string[]): Promise<unknown> {
  const proc = Bun.spawn(["ccusage", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(`ccusage exited with ${exitCode}`);
  const text = await new Response(proc.stdout).text();
  return JSON.parse(text);
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const todayFormatted = today.replace(/-/g, ""); // YYYYMMDD

  // Compute yesterday for blocks --since (catch cross-midnight active blocks)
  const yesterdayDate = new Date(Date.now() - 86400_000);
  const yesterdayFormatted = yesterdayDate.toISOString().slice(0, 10).replace(/-/g, "");

  // Fetch daily token totals
  const dailyData = await runCcusage([
    "daily", "--since", todayFormatted, "--until", todayFormatted,
    "--json", "--offline"
  ]) as { totals: { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; totalCost: number } };

  const totals = dailyData.totals;

  // Fetch active block
  const blocksData = await runCcusage([
    "blocks", "--since", yesterdayFormatted, "--json", "--offline"
  ]) as Array<{ isActive: boolean; costUSD: number; burnRate: { costPerHour: number }; projection: { remainingMinutes: number; totalCost: number } }>;

  const activeBlock = Array.isArray(blocksData) ? blocksData.find(b => b.isActive === true) : undefined;

  await upsertDailyTokens({
    date: today,
    inputTokens: totals.inputTokens ?? 0,
    outputTokens: totals.outputTokens ?? 0,
    cacheCreationTokens: totals.cacheCreationTokens ?? 0,
    cacheReadTokens: totals.cacheReadTokens ?? 0,
    blockCost: activeBlock?.costUSD ?? 0,
    blockRemainingMin: Math.floor(activeBlock?.projection.remainingMinutes ?? 0),
    blockProjectionCost: activeBlock?.projection.totalCost ?? 0,
    burnRatePerHour: activeBlock?.burnRate.costPerHour ?? 0,
    totalCost: totals.totalCost ?? 0,
    updatedAt: new Date().toISOString(),
  });
}

main().catch(() => {
  // Fail silently — never crash the cron
  process.exit(0);
});
```

---

## Task 3 — Config Types + Defaults

**Files:** `src/lib/config-types.ts`, `defaults.json`, `statusline.config.json`  
**Dependencies:** None (independent of Tasks 1 & 2)

### 3a. `src/lib/config-types.ts` — add to `StatuslineConfig` interface

After the `dailySpend` field (optional, so `?.` access in index.ts is valid):
```typescript
tokenBreakdown?: {
  enabled: boolean;
};
```

### 3b. `defaults.json` — add after `dailySpend`

```json
"tokenBreakdown": {
  "enabled": false
}
```

### 3c. `statusline.config.json` — add after `dailySpend`

```json
"tokenBreakdown": {
  "enabled": true
}
```

---

## Task 4 — Renderer: `formatTokenBreakdownPart`

**File:** `src/lib/render-pure.ts`  
**Dependencies:** Task 1 (needs `DailyTokensRow` type), Task 3 (needs config type)

### 4a. Define and export `TokenBreakdownData` in render-pure.ts

Define inline (no import from spend/ — keeps renderer free of feature deps). **Export it** so `index.ts` can import the type from render-pure.ts.

Add near the top of render-pure.ts:
```typescript
export interface TokenBreakdownData {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  blockCost: number;
  blockRemainingMin: number;
  blockProjectionCost: number;
  burnRatePerHour: number;
  totalCost: number;
}
```

### 4b. Add `tokenBreakdown` to `RawStatuslineData`

```typescript
tokenBreakdown?: TokenBreakdownData | null;
```

### 4c. Add `formatTokenBreakdownPart` function

Add after `formatDailyPart`:

```typescript
const TOKEN_PRICES = {
  input: 3,
  output: 15,
  cacheWrite: 3.75,
  cacheRead: 0.30,
} as const;

function tokenCostPct(tokens: number, pricePerMTok: number, totalCost: number): number {
  if (totalCost <= 0) return 0;
  return Math.round((tokens * pricePerMTok / 1_000_000) / totalCost * 100);
}

function formatTokenBreakdownPart(
  data: TokenBreakdownData | null | undefined,
  config: StatuslineConfig["tokenBreakdown"],
): string {
  if (!config?.enabled || !data || data.totalCost <= 0) return "";

  const inPct = tokenCostPct(data.inputTokens, TOKEN_PRICES.input, data.totalCost);
  const outPct = tokenCostPct(data.outputTokens, TOKEN_PRICES.output, data.totalCost);
  const cwPct = tokenCostPct(data.cacheCreationTokens, TOKEN_PRICES.cacheWrite, data.totalCost);
  const crPct = tokenCostPct(data.cacheReadTokens, TOKEN_PRICES.cacheRead, data.totalCost);

  const breakdownStr = `in:${inPct}% out:${outPct}% cw:${cwPct}% cr:${crPct}%`;
  const parts = [breakdownStr];

  if (data.burnRatePerHour > 0) {
    const burnStr = `🔥 $${data.burnRatePerHour.toFixed(1)}/h → $${data.blockProjectionCost.toFixed(0)} (${formatDuration(data.blockRemainingMin * 60_000)})`;
    parts.push(burnStr);
  }

  return `${colors.gray("T:")} ${parts.join(` ${colors.gray("·")} `)}`;
}
```

### 4d. Call in `renderStatuslineRaw`

After the `dailyPart` section:
```typescript
// Token breakdown
const tokenBreakdownPart = formatTokenBreakdownPart(
  data.tokenBreakdown,
  config.tokenBreakdown,
);
if (tokenBreakdownPart) sections.push(tokenBreakdownPart);
```

---

## Task 5 — `index.ts`: Wire up getDailyTokens + staleness check

**File:** `src/index.ts`  
**Dependencies:** Tasks 1, 3, 4

### 5a. Add lazy import for `getDailyTokens`

In the optional feature imports block:
```typescript
let getDailyTokens: any = null;
```

In the spend module try/catch:
```typescript
getDailyTokens = spendModule.getDailyTokens;
```

### 5b. Import `TokenBreakdownData` type from render-pure.ts

At top of file (static import — type only, no runtime cost):
```typescript
import type { TokenBreakdownData } from "./lib/render-pure";
```

### 5c. Add staleness check + pass to render data

After the existing `todayCost`/`weekCost` block:
```typescript
const STALE_THRESHOLD_MS = 3 * 60 * 1000; // 3 min = 3× cron interval
// Note: using UTC date — consistent with sessions table and ccusage --since flags
const today = new Date().toISOString().slice(0, 10);
let tokenBreakdown: TokenBreakdownData | null = null;
if (getDailyTokens && config.tokenBreakdown?.enabled) {
  const rawTokens = getDailyTokens(today);
  if (rawTokens && Date.now() - new Date(rawTokens.updatedAt).getTime() < STALE_THRESHOLD_MS) {
    tokenBreakdown = rawTokens;
  }
}
```

Note on timezone: UTC date is used consistently in both the DB (`sessions` table) and ccusage calls. The sync script uses `new Date().toISOString().slice(0, 10)` for both the DB key and ccusage `--since/--until` flags. Minor mismatch possible near UTC midnight for users in UTC+ timezones — acceptable known limitation.
```

### 5c. Add to `data` object

```typescript
...(getDailyTokens && { tokenBreakdown }),
```

---

## Task 6 — Register Shed Cron

**Dependencies:** Task 2 complete (script must exist)

```bash
shed add statusline-token-sync \
  --schedule "* * * * *" \
  --command "bun ~/projects/claude-statusline/src/lib/features/spend/commands/sync-daily-tokens.ts" \
  --tag statusline
```

---

## Task Order & Parallelism

```
Tasks 1, 3 → can run in parallel (no dependencies between them)
Task 2 → after Task 1 (imports from spend/index.ts)
Task 4 → after Tasks 1, 3 (needs DailyTokensRow shape and config type)
Task 5 → after Tasks 1, 4 (imports getDailyTokens, uses TokenBreakdownData type)
Task 6 → after Task 2 (shed requires the script to exist)
```

---

## Verification

```bash
# 1. Trigger sync manually
shed run statusline-token-sync

# 2. Verify DB row populated
bun -e "
import { getDailyTokens } from './src/lib/features/spend/index.ts';
const today = new Date().toISOString().slice(0, 10);
console.log(getDailyTokens(today));
"

# 3. Test statusline display
cat data/last_payload.txt | bun src/index.ts

# 4. Run linter
bun run lint
```

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| `ccusage` not installed | Sync fails silently, `getDailyTokens(today)` → null, T: hidden |
| No active block | `blockRemainingMin=0`, burn rate hidden, token % still shown |
| `totalCost=0` | All pct=0%, segment hidden |
| Updated > 3 min ago | `tokenBreakdown=null`, segment hidden |
| Config missing `tokenBreakdown` key | `config.tokenBreakdown?.enabled ?? false` → hidden |
