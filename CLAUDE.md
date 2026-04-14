# Claude Code Statusline - Project Memory

## Overview

Clean, type-safe statusline implementation for Claude Code using Bun + TypeScript. Displays real-time session information, git status, context usage, and Claude API rate limits.

## Project Setup & Configuration

### Dependencies

- **Bun**: Runtime (uses `$` for shell commands, `bun:sqlite` for DB)
- **@biomejs/biome**: Linting & formatting
- **picocolors**: Terminal colors (for spend commands)
- **table**: Table rendering (for spend commands)

No external npm packages required beyond the above.

### Configuration in Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bun ~/.claude/scripts/statusline/src/index.ts",
    "padding": 0
  }
}
```

### Authentication (fallback only)

OAuth token stored in macOS Keychain — used only when `rate_limits` is absent from hook payload:

- **Service**: `Claude Code-credentials`
- **Format**: JSON with `claudeAiOauth.accessToken`
- **Token type**: `sk-ant-oat01-...` (OAuth token, not API key)
- **Access**: `security find-generic-password -s "Claude Code-credentials" -w`

## Architecture

### Modular Design

```
src/
├── index.ts                          # Main entry — orchestrates all components
└── lib/
    ├── types.ts                      # TypeScript interfaces (HookInput)
    ├── git.ts                        # Git operations (branch, staged/unstaged changes)
    ├── context.ts                    # Transcript parsing & context calculation (fallback)
    ├── period.ts                     # Period ID normalization (normalizeResetsAt)
    ├── render-pure.ts                # Pure renderer — raw data in, formatted string out
    ├── formatters.ts                 # ANSI color codes, display utilities
    └── features/
        ├── limits/
        │   └── index.ts              # OAuth API usage limits (5h + 7d)
        └── spend/
            ├── index.ts              # SQLite singleton, schema, all spend logic
            └── commands/
                ├── spend-today.ts    # CLI: today's sessions table
                ├── spend-month.ts    # CLI: monthly spend by date
                ├── spend-project.ts  # CLI: spend grouped by project
                ├── sync-daily-tokens.ts  # CLI: ccusage → daily_tokens upsert
                ├── sync-session-tokens.ts  # CLI: ccusage → session_token_breakdown upsert
                └── migrate-to-sqlite.ts  # CLI: migrate old JSON → SQLite
```

### Data Flow

```
Claude Code Hook → stdin JSON → index.ts
                                    ↓
                  ┌─────────────────┼─────────────────┐
                  ↓                 ↓                  ↓
          [Rate limits]       [Git status]     [Context tokens]
          from payload        from git CLI     from payload
          (fallback: API)                      (fallback: transcript)
                  └─────────────────┼─────────────────┘
                                    ↓
                           [SQLite reads]
                           period cost, week cost,
                           daily tokens
                                    ↓
                         renderStatuslineRaw()
                                    ↓
                            stdout (2 lines)
```

## Component Specifications

### Context Calculation (`lib/context.ts`)

- **Primary**: Reads `input.context_window.current_usage` from hook payload
- **Fallback**: Parses `.jsonl` transcript, finds most recent main-chain entry
- **Tokens counted**: `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`
- **Excludes**: Sidechain entries (agent calls), API error messages
- **Output**: `{ tokens: number, percentage: number }` (0-100% of context window)

### Usage Limits (`lib/features/limits/index.ts`)

- **Primary**: Reads `input.rate_limits` from hook payload (no API call)
- **Fallback**: Fetches from `https://api.anthropic.com/api/oauth/usage` via Keychain auth
- **Data**: 5-hour window + 7-day window utilization and reset times
- **Error handling**: Fails silently, returns null on errors

### Git Status (`lib/git.ts`)

- **Purpose**: Show current branch and uncommitted changes
- **Detection**: Counts staged and unstaged additions/deletions/files separately
- **Output**: `{ branch, hasChanges, staged, unstaged }`
- **Display**: `main* +123 -45 ~2 ~1` with color coding

### Spend / SQLite (`lib/features/spend/index.ts`)

- **DB**: `data/spend.db` (WAL mode)
- **Tables**: `sessions`, `session_period_tracking`, `periods`, `daily_tokens`, `session_token_breakdown`
- **`daily_tokens`**: Upserted by `sync-daily-tokens.ts` — one row per day, updated in place
- **`session_token_breakdown`**: Upserted by `sync-session-tokens.ts` — one row per active session, 24h TTL cleanup
- **Singleton**: `getDb()` — use `setDb()` / `resetDb()` for test injection only

### Pure Renderer (`lib/render-pure.ts`)

- **Input**: `RawStatuslineData` — all raw numbers/strings, no pre-formatting
- **Output**: Two-line string ready for stdout
- **Segments**: `S:` session · `5h` limits · `7d` weekly · `D:` daily · `T:` token breakdown
- **No I/O, no side effects** — pure function, fully testable

## Output Specification

### Line 1: Git + Path + Model

```
main* +12 -3 · ~/projects/myapp · Sonnet 4.6 (200K context)
```

### Line 2: Metrics

```
S: $0.17 62.5K ⣿⣿⣿⣀⣀⣀⣀⣀⣀⣀ 31% (6m) · 5h $1.2 15% (3h27m) · 7d $8.4 45% (+2.1%) (6d12h) · D: $4.50 · T: in:12% out:55% cw:18% cr:15%
```

**Segments:**

| Label | Content |
|-------|---------|
| `S:` | Session cost · context tokens · braille progress bar · context % · duration |
| `5h` | Period cost · 5h utilization % · reset countdown |
| `7d` | Week cost · 7d utilization % · pacing delta · reset countdown |
| `D:` | Daily total cost (from ccusage via `daily_tokens`) |
| `T:` | Token cost % breakdown (in/out/cw/cr) + burn rate if block active |

## Development

### Running commands

```bash
# Run the statusline (requires hook JSON on stdin)
echo '{ ... }' | bun run src/index.ts

# Today's sessions
bun src/lib/features/spend/commands/spend-today.ts

# Monthly spend
bun src/lib/features/spend/commands/spend-month.ts

# Sync ccusage → daily_tokens
bun src/lib/features/spend/commands/sync-daily-tokens.ts

# Sync ccusage → session_token_breakdown
bun src/lib/features/spend/commands/sync-session-tokens.ts

# Format / lint
bunx biome format --write .
bunx biome lint .
```

### Testing

```bash
bun test
bun test src/tests/spend-v2.test.ts
bun test src/tests/daily-tokens.test.ts
```

Tests use `setDb()` / `resetDb()` for in-memory SQLite injection — no production DB touched.

### Error Handling & Performance

**Error Handling** — All components fail silently:

- Missing transcript → 0 tokens, 0%
- API failure → No usage limits shown
- Git errors → "no-git" branch
- Keychain access denied → No usage limits shown
- ccusage unavailable → `D:` and `T:` segments hidden

**Performance Benchmarks:**

- Context calculation: ~10-50ms (depends on transcript size)
- API call: ~100-300ms (cached; skipped if payload has rate_limits)
- Git operations: ~20-50ms
- SQLite reads: <5ms
- Total: < 500ms typical

## Maintenance Guide

### Adding New Metrics

1. Add interface to `lib/render-pure.ts` (or `lib/types.ts`)
2. Create fetcher in `lib/*.ts` or `lib/features/*/`
3. Import dynamically in `index.ts`
4. Add render function to `lib/render-pure.ts`
5. Wire into `renderStatuslineRaw()`

### Modifying Display

- Colors: Edit `lib/formatters.ts` `colors` constant
- Layout: Modify format functions in `lib/render-pure.ts`
- Formatting: Add functions to `lib/formatters.ts`

## Known Limitations

- macOS only (uses Keychain for OAuth fallback)
- Requires `git` CLI for git status
- `sync-daily-tokens.ts` requires `ccusage` CLI
- Requires Claude Code OAuth (not API key)
