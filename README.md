# Claude Code Statusline

Clean, modular statusline for Claude Code with TypeScript + Bun.

## Features

- 🌿 Git branch with changes (+added -deleted ~staged ~unstaged)
- 🧩 Session cost, context tokens, context %, and duration (`S:`)
- ⏱️ Five-hour usage limit with period cost and reset time (`5h`)
- 📅 Seven-day usage limit with weekly pacing delta (`7d`)
- 💰 Daily cost from ccusage (`D:`)
- 📊 Token breakdown by type with live burn rate (`T:`)

## Output

Two-line statusline:

```
main* +12 -3 · ~/projects/myapp · Sonnet 4.6 (200K context)
S: $0.17 62.5K ⣿⣿⣿⣀⣀⣀⣀⣀⣀⣀ 31% (6m) · 5h $1.2 15% (3h27m) · 7d $8.4 45% (+2.1%) (6d12h) · D: $4.50 · T: in:12% out:55% cw:18% cr:15%
```

**Segments:**

| Segment | Content |
|---------|---------|
| `S:` | Session cost · context tokens · progress bar · context % · duration |
| `5h` | Period cost · 5-hour utilization % · reset countdown |
| `7d` | Week cost · 7-day utilization % · pacing delta · reset countdown |
| `D:` | Daily total cost from ccusage (updated by cron) |
| `T:` | Token cost breakdown by type + burn rate if block is active |

## Structure

```
src/
├── index.ts                          # Main entry — orchestrates all components
└── lib/
    ├── types.ts                      # TypeScript interfaces (HookInput)
    ├── git.ts                        # Git status (branch, staged, unstaged changes)
    ├── context.ts                    # Transcript parsing & context calculation (fallback)
    ├── period.ts                     # Period ID normalization
    ├── render-pure.ts                # Pure renderer — raw data in, formatted string out
    ├── formatters.ts                 # ANSI colors, formatting utilities
    └── features/
        ├── limits/
        │   └── index.ts              # OAuth API usage limits
        └── spend/
            ├── index.ts              # SQLite DB (sessions, periods, daily_tokens)
            └── commands/
                ├── spend-today.ts    # Today's sessions table
                ├── spend-month.ts    # Monthly spend grouped by date
                ├── spend-project.ts  # Spend grouped by project
                ├── sync-daily-tokens.ts  # Sync ccusage → daily_tokens table
                └── migrate-to-sqlite.ts  # Migrate old JSON data to SQLite
```

## Usage in Claude Code

Update your `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bun ~/.claude/scripts/statusline/src/index.ts",
    "padding": 0
  }
}
```

## Spend Tracking

Session data is stored in `data/spend.db` (SQLite). Four tables:

| Table | Content |
|-------|---------|
| `sessions` | One row per session: cost, duration, lines, cwd |
| `session_period_tracking` | Per-session period cost deltas |
| `periods` | Aggregated cost per 5-hour period |
| `daily_tokens` | Daily token counts from ccusage (upserted, one row per day) |

### Viewing spend data

Run directly with Bun:

```bash
# Today's sessions
bun src/lib/features/spend/commands/spend-today.ts

# Monthly spend grouped by date
bun src/lib/features/spend/commands/spend-month.ts

# Spend grouped by project
bun src/lib/features/spend/commands/spend-project.ts
```

### Syncing daily tokens

`sync-daily-tokens.ts` fetches today's aggregated token data from ccusage and upserts it into `daily_tokens`. It uses `INSERT ... ON CONFLICT(date) DO UPDATE` — one row per day, always updated in place.

```bash
bun src/lib/features/spend/commands/sync-daily-tokens.ts
```

Intended to be triggered by a cron job or Claude Code hook.

## Architecture

### Data flow

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

### Optional features

Features are loaded dynamically. Delete or rename the feature folder to disable it — the statusline continues to work without it:

- `src/lib/features/limits/` — 5h/7d usage limits
- `src/lib/features/spend/` — session tracking, period cost, daily tokens

### Context window

Context tokens are read from `input.context_window.current_usage` (provided directly by the Claude Code hook payload). Falls back to transcript parsing if the payload field is absent.

### Rate limits

5-hour and 7-day limits are read from `input.rate_limits` (hook payload). Falls back to the OAuth API if not present.

## Development

```bash
# Install dependencies
bun install

# Run the statusline (requires hook JSON on stdin)
echo '{ ... }' | bun run src/index.ts

# Format code
bunx biome format --write .

# Lint code
bunx biome lint .
```

## Testing

```bash
# Run all tests
bun test

# Run specific test suite
bun test src/tests/spend-v2.test.ts
bun test src/tests/daily-tokens.test.ts
```

## Authentication

The OAuth token is stored in macOS Keychain (used as fallback when `rate_limits` is not in the hook payload):

- **Service**: `Claude Code-credentials`
- **Format**: JSON with `claudeAiOauth.accessToken`
- **Token type**: `sk-ant-oat01-...`
- **Access**: `security find-generic-password -s "Claude Code-credentials" -w`

## Known Limitations

- macOS only (Keychain for OAuth token fallback)
- Requires `git` CLI for git status
- `sync-daily-tokens.ts` requires `ccusage` CLI to be installed
