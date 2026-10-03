# lm-memory-mcp

One small MCP server that gives an LM Studio model persistent memory. Plain files, no database, no embeddings, no build step.

## Setup

```node
npm install
npm test            # 8 tests, should all pass
```

## Add to LM Studio

LM Studio -> Program tab -> Install -> Edit mcp.json, then add (use your real absolute path):

```json

{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["C:/path/to/lm-memory-mcp/src/server.js"],
      "env": { "MEMORY_DIR": "C:/path/to/lm-memory-data" }
    }
  }
}

```

Memory lives in `MEMORY_DIR` (default `~/.lm-memory`): `memory.jsonl` and `state.json`. Both are readable and editable by hand.

## Tools the model sees (4, ~275 tokens of schema)

| tool | purpose |

|---|---|
| `memory_boot` | returns state + top memories in one compact block (~350 token budget) |
| `remember(text, tags?)` | saves one short fact as `unverified` (max 300 chars, near-duplicates ignored) |
| `recall(query)` | BM25 keyword search, max 3 results |
| `state_set(key, value)` | small key-value state, empty value clears |

## Suggested system prompt (keep it this short)

```txt
You have memory tools. At the start of a conversation call memory_boot once.
Use recall before answering questions about past work or preferences.
Use remember only for durable facts the user states. One fact per call, under 300 characters.
Entries marked (?) are unverified: treat them as likely, not certain.
```

## You are the quality gate (CLI)

The model never runs these. Run from this folder, with the same MEMORY_DIR set:

```ps
node src/cli.js list unverified     # review what the model saved
node src/cli.js approve <id> ...    # mark verified (ranked higher, never expires)
node src/cli.js reject <id> ...     # hide it, removed on next compact
node src/cli.js compact             # dedupe, drop rejected, expire unverified after 30 days
node src/cli.js boot                # preview exactly what memory_boot returns
node src/cli.js stats | search <q> | add <text>

```tasksch
Schedule `compact` daily (Task Scheduler / cron) so optimisation costs the model nothing.
