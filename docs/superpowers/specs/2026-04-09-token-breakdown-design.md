# Token Breakdown Feature — Design Spec

**Date:** 2026-04-09  
**Project:** claude-statusline  
**Status:** Draft

---

## Overview

Add a `T:` segment to the statusline that displays real-time token usage breakdown by type, with burn rate and block projection. Data is synced asynchronously every minute via a `shed` cron job that calls `ccusage`.

```
T: in:1% out:5% cw:46% cr:58% · 🔥 $9.9/h → $49 (2h58m)
```

---

## Architecture

### Components

```
┌─────────────────────────────────────────────────┐
│  shed cron (every minute)                       │
│  bun sync-daily-tokens.ts                       │
│    → ccusage daily --offline --json             │
│    → ccusage blocks --offline --json            │
│    → upsertDailyTokens(data) → spend.db         │
└────────────────────┬────────────────────────────┘
                     │ SQLite
┌────────────────────▼────────────────────────────┐
│  index.ts (on each Claude Code hook)            │
│    → getDailyTokens(today)                      │
│    → staleness check: if now - updatedAt > 3min │
│      → pass null                                │
│    → pass TokenBreakdown | null to renderer     │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  render-pure.ts                                 │
│    → formatTokenBreakdownPart(data | null)      │
│    → returns "" if null                         │
└─────────────────────────────────────────────────┘
```

---

## Step 1 — SQLite Table `daily_tokens`

**Location:** Added to `getDb()` in `src/lib/features/spend/index.ts`

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

**Migration strategy:** `CREATE TABLE IF NOT EXISTS` — safe on existing DB.

### New Functions

```typescript
export function upsertDailyTokens(data: DailyTokensRow): void
export function getDailyTokens(date: string): DailyTokensRow | null
```

**DailyTokensRow interface** (defined in `types.ts` or inline in spend/index.ts):
```typescript
interface DailyTokensRow {
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
  updatedAt: string; // ISO 8601
}
```

---

## Step 2 — Sync Script

**Location:** `src/lib/features/spend/commands/sync-daily-tokens.ts`

### ccusage Calls

```bash
# Daily token totals
ccusage daily --since YYYYMMDD --until YYYYMMDD --json --offline
# → { "totals": { "inputTokens", "outputTokens", "cacheCreationTokens", "cacheReadTokens", "totalCost" } }

# Active block
ccusage blocks --since YYYYMMDD --json --offline
# → blocks[] — find one with isActive: true
# → { costUSD, burnRate: { costPerHour }, projection: { remainingMinutes, totalCost } }
```

### Script Logic

```typescript
1. Compute today = new Date().toISOString().slice(0, 10)  // UTC — consistent with spend/index.ts sessions table
2. Compute yesterday = day before today (for blocks --since, to catch cross-midnight active blocks)
3. Run: ccusage daily --since TODAY --until TODAY --json --offline → parse totals
4. Run: ccusage blocks --since YESTERDAY --json --offline → find first block with isActive === true
   (using yesterday as --since catches active blocks that started before midnight)
5. upsertDailyTokens({
     date: today,
     inputTokens: totals.inputTokens,
     outputTokens: totals.outputTokens,
     cacheCreationTokens: totals.cacheCreationTokens,
     cacheReadTokens: totals.cacheReadTokens,
     blockCost: activeBlock?.costUSD ?? 0,
     blockRemainingMin: Math.floor(activeBlock?.projection.remainingMinutes ?? 0),
     blockProjectionCost: activeBlock?.projection.totalCost ?? 0,
     burnRatePerHour: activeBlock?.burnRate.costPerHour ?? 0,  // from ccusage, not computed
     totalCost: totals.totalCost,
     updatedAt: new Date().toISOString(),
   })
   Note: burnRatePerHour and blockProjectionCost come directly from ccusage output — not computed by us.
   If multiple isActive blocks exist, take the first one (no overlap expected in practice).
6. Fail silently if ccusage not available (catch all)
```

### Path Resolution

The script imports `getDb` and `upsertDailyTokens` from `../../index.ts` (relative to its location in `commands/`), ensuring the same DB singleton and path as all other consumers.

---

## Step 3 — Shed Cron

```bash
shed add statusline-token-sync \
  --schedule "* * * * *" \
  --command "bun ~/projects/claude-statusline/src/lib/features/spend/commands/sync-daily-tokens.ts" \
  --tag statusline
```

Registered once. No lock needed — ccusage with `--offline` completes in <100ms, well under 60s interval.

---

## Step 4 — Display

### Config Extension

**`src/lib/config-types.ts`** — add to `StatuslineConfig`:
```typescript
tokenBreakdown: {
  enabled: boolean;
};
```

**`src/lib/config.ts`** — add default:
```typescript
tokenBreakdown: { enabled: false }
```

**`statusline.config.json`** — opt-in:
```json
"tokenBreakdown": { "enabled": true }
```

**`src/commands/interactive-config.ts`** — add prompt for `tokenBreakdown.enabled`.

### RawStatuslineData Extension

```typescript
tokenBreakdown?: DailyTokensRow | null;
```

### Staleness Guard (in `index.ts`)

```typescript
const STALE_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes = 3× cron interval
const today = new Date().toISOString().slice(0, 10); // UTC — same as sessions table
const rawDailyTokens = getDailyTokens ? getDailyTokens(today) : null;
const tokenBreakdown =
  rawDailyTokens &&
  Date.now() - new Date(rawDailyTokens.updatedAt).getTime() < STALE_THRESHOLD_MS
    ? rawDailyTokens
    : null;
```

**WAL mode:** `getDb()` already enables `PRAGMA journal_mode = WAL` — concurrent reads from the cron process and the statusline hook are safe without additional retry logic.

**Config fallback:** Access via `config.tokenBreakdown?.enabled ?? false` to handle legacy configs missing the key.

### Token % Formula

Per-type **cost contribution** (not token count share — intentional per spec: shows where money goes):
```typescript
const pct = (tokens: number, pricePerMTok: number, totalCost: number): number =>
  totalCost > 0 ? Math.round((tokens * pricePerMTok / 1_000_000) / totalCost * 100) : 0;

// Prices per MTok
const INPUT_PRICE = 3;       // $3/MTok
const OUTPUT_PRICE = 15;     // $15/MTok
const CACHE_WRITE_PRICE = 3.75; // $3.75/MTok
const CACHE_READ_PRICE = 0.30;  // $0.30/MTok
```

### Display Format

```
T: in:1% out:5% cw:46% cr:58% · 🔥 $9.9/h → $49 (2h58m)
```

- `in:` = input tokens cost %
- `out:` = output tokens cost %
- `cw:` = cache creation cost %
- `cr:` = cache read cost %
- `🔥 $9.9/h` = burn rate (burnRatePerHour)
- `→ $49` = projected block total cost
- `(2h58m)` = time remaining in block

**Visibility:** Hidden if `config.tokenBreakdown.enabled === false` OR `tokenBreakdown === null` (stale/absent).

**Burn rate section:** Hidden if `burnRatePerHour === 0` (no active block).

---

## Error Handling

All new code follows the existing pattern:
- DB operations: `try/catch` → return null / 0, never throw
- sync script: outer try/catch wraps everything → `process.exit(0)` regardless
- renderer: null input → empty string

---

## Testing

```bash
# Trigger sync manually
shed run statusline-token-sync

# Verify DB row
bun -e "import { getDailyTokens } from './src/lib/features/spend/index.ts'; console.log(getDailyTokens(new Date().toISOString().slice(0,10)))"

# Test statusline display
cat data/last_payload.txt | bun src/index.ts
```

---

## Files Modified / Created

| File | Action |
|------|--------|
| `src/lib/features/spend/index.ts` | Add `daily_tokens` table, `upsertDailyTokens`, `getDailyTokens` |
| `src/lib/features/spend/commands/sync-daily-tokens.ts` | Create — standalone sync script |
| `src/lib/config-types.ts` | Add `tokenBreakdown` to `StatuslineConfig` |
| `src/lib/config.ts` | Add default for `tokenBreakdown` |
| `statusline.config.json` | Add `tokenBreakdown: { enabled: true }` |
| `src/lib/render-pure.ts` | Add `tokenBreakdown` to `RawStatuslineData`, `formatTokenBreakdownPart()` |
| `src/index.ts` | Call `getDailyTokens`, staleness check, pass to render |
| `src/commands/interactive-config.ts` | Add `tokenBreakdown.enabled` prompt |
