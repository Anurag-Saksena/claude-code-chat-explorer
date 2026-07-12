# Claude Code Chat Explorer

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/drewburchfield/claude-code-chat-explorer)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Browse, search, and explore your Claude Code conversation history. A fast, self-hosted web interface powered by SQLite with full-text search.

![Claude Code Chat Explorer](assets/screenshot.png)

> [!WARNING]
> **Claude Code deletes conversations older than 30 days by default.** Before using this tool, [increase your retention period](#conversation-history-retention-important) or you may have already lost history.

## Why This Exists

Claude Code stores all your conversations locally in `~/.claude/projects/` as JSONL files, but there's no built-in way to browse or search them. This tool gives you:

- **Full-text search** across all your conversations
- **Project organization** - see conversations grouped by project
- **Real-time updates** - new messages appear instantly via WebSocket
- **Token tracking** - monitor your usage patterns
- **Mobile-friendly** - works on desktop and mobile browsers

## Quick Start

```bash
# Clone the repository
git clone https://github.com/drewburchfield/claude-code-chat-explorer.git
cd claude-code-chat-explorer

# Start the container
./quick-start.sh
```

Open **http://localhost:9876** in your browser.

## Features

### Browse & Search
- **Project view** - Conversations organized by project directory
- **Full-text search** - Fast FTS5-powered search with highlighted snippets
- **Session details** - See token counts, models used, and activity timelines

### Conversation Viewer
- **Full message history** - User and assistant messages with timestamps
- **Tool calls** - Expandable view of tool usage with parameters and results
- **In-conversation search** - Find specific content within long conversations
- **Export** - Download conversations as JSON

### Real-time Monitoring
- **Live updates** - New conversations and messages appear instantly
- **Activity indicators** - See which sessions are active
- **Subagent tracking** - View spawned Task tool agents grouped under parents

### Transfer & Resume Sessions on Another Machine
Move Claude Code conversations to a different laptop and **continue them with `claude --resume`**. Unlike the markdown "Download" (which is context you paste back in), these exports are **lossless** — they preserve the full transcript, the `parentUuid` chain, and subagent sidechains — so the session reappears in Claude Code's session list and can be resumed as if it never left.

- **Single session** — the **Export** button in a conversation's header downloads a resumable `.ccsession.json`.
- **Whole history** — the **Export All** button downloads one `.ccbundle.json` containing every session.
- **Import** — the **Import** button loads a package or bundle onto the current machine.
- A standalone CLI (`src/session-io.js`) does the same without the web server — ideal for the receiving laptop.

See [Transferring Sessions Between Machines](#transferring-sessions-between-machines) for the exact commands.

## Requirements

- Docker and Docker Compose
- Claude Code installed (with conversations in `~/.claude`)

## How It Works

1. **Scans** your `~/.claude/projects/` directory for conversation files
2. **Indexes** conversations into a SQLite database with full-text search
3. **Watches** for changes and updates the index incrementally
4. **Serves** a web interface on port 9876

The database and all processing happens locally. Your conversations never leave your machine.

## Architecture

```
claude-code-chat-explorer/
├── Dockerfile              # Multi-stage Alpine build
├── docker-compose.yml      # Container configuration
├── quick-start.sh          # Startup script
├── package.json            # Dependencies
├── src/
│   ├── chats-mobile.js     # Express server
│   ├── analytics/
│   │   ├── core/           # Conversation parsing
│   │   └── data/           # SQLite + FTS5 layer
│   └── analytics-web/
│       └── chats_mobile.html  # Web UI
└── test/                   # Vitest test suite
```

## Configuration

### Conversation History Retention (Important!)

Claude Code **deletes conversations older than 30 days by default**. If you want to preserve your history for this tool to browse, you need to increase the retention period.

Edit `~/.claude/settings.json` and add or modify the `cleanupPeriodDays` setting:

```json
{
  "cleanupPeriodDays": 99999
}
```

| Value | Behavior |
|-------|----------|
| `99999` | Effectively infinite (recommended) |
| `365` | Keep conversations for 1 year |
| `30` | Default - deletes sessions inactive for 30+ days |

**Note:** Cleanup happens when you start a new Claude Code session, not continuously. If you've already lost history, it cannot be recovered.

If the file doesn't exist, create it:
```bash
echo '{"cleanupPeriodDays": 99999}' > ~/.claude/settings.json
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_HOME` | `~/.claude` | Claude Code data directory |
| `CLAUDE_DB_PATH` | `/data/conversations.db` | Database location |

### Change Port

Edit `docker-compose.yml`:
```yaml
ports:
  - "9877:9876"  # Use port 9877 instead
```

## Management

```bash
# View logs
docker compose logs -f

# Stop
docker compose down

# Restart
docker compose restart

# Rebuild after updates
docker compose up -d --build

# Reset database (re-indexes everything)
docker compose down -v
docker compose up -d --build
```

## Security

The container runs hardened:
- Non-root user
- Read-only filesystem
- Dropped capabilities
- Memory limits (1GB)
- Localhost-only port binding

Your Claude data is mounted read-only.

## Troubleshooting

### No conversations showing?
Check that Claude Code has conversations:
```bash
find ~/.claude/projects -name "*.jsonl" | head -5
```

### Container won't start?
Check logs:
```bash
docker compose logs --tail=50
```

### Port conflict?
Change the port in `docker-compose.yml` and restart.

## Transferring Sessions Between Machines

Export Claude Code sessions from one machine and import them on another so they can be **continued** with `claude --resume`. The CLI (`src/session-io.js`, also aliased as `npm run session --`) reads and writes `~/.claude` directly and does **not** require the web server, so it works well on the receiving laptop.

> **Session ids:** single-session `import` mints a fresh id (safe to clone into a repo, no collisions); `import-all` **preserves** the original ids by default so a fresh machine reproduces the exact session list. Add `--fresh-ids` to `import-all` to mint new ids instead.

### Export everything, import everything (whole-history transfer)

On the **source** machine:

```bash
# Bundle every local session into one portable file
node src/session-io.js export-all
# → writes claude-sessions-bundle-YYYY-MM-DD.ccbundle.json

# (optional) choose the output path
node src/session-io.js export-all -o ~/Desktop/my-chats.ccbundle.json
```

Copy the `.ccbundle.json` to the **target** machine (AirDrop, scp, USB, etc.), then:

```bash
# Restore every session at its original repo path
node src/session-io.js import-all claude-sessions-bundle-YYYY-MM-DD.ccbundle.json

# If your home/repo paths differ on the new machine, remap the path prefix:
node src/session-io.js import-all my-chats.ccbundle.json --map /Users/alice=/Users/bob

# Re-importing onto a machine that already has some of these sessions:
node src/session-io.js import-all my-chats.ccbundle.json --fresh-ids   # mint new ids (no clashes)
node src/session-io.js import-all my-chats.ccbundle.json --force       # overwrite existing ids
```

Then open Claude Code in the relevant repo and pick the session from the list, or `claude --resume <id>`.

### Export one session, import it into a specific repo

```bash
# Source machine — export by session id (or by path to its .jsonl)
node src/session-io.js export 21e91de8-6405-4296-95fc-b8bf9586bec9
node src/session-io.js export ~/.claude/projects/-Users-alice-app/21e91de8-....jsonl -o chat.ccsession.json

# Target machine — attach it to a repo on THIS machine and resume
node src/session-io.js import chat.ccsession.json --cwd ~/code/my-app
cd ~/code/my-app
claude --resume <printed-session-id>
```

Useful flags for single `import`: `--cwd <path>` (which repo to attach to; default: current directory), `--keep-id` (reuse the original id instead of minting one), `--force` (overwrite an existing transcript).

### List local sessions

```bash
node src/session-io.js list      # prints each session's id, cwd, and file path
```

### Same actions from the dashboard

The web UI mirrors the CLI: **Export All** / **Import** in the top header, and a per-conversation **Export** button beside **Download**. Import via the UI installs into `~/.claude` on whatever machine is running the server.

## Development

```bash
npm install
npm test              # Run tests
npm run test:coverage # With coverage
npm run test:watch    # Watch mode
```

## License

MIT
