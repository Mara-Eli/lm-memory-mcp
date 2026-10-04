# lm-memory-mcp

One small MCP server that gives an LM Studio model persistent memory. Plain files, no database, no embeddings, no build step.

## Setup

```node
npm install
npm test            # 18 tests, should all pass
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

## Tools the model sees (5, ~340 tokens of schema)

| tool | purpose |

|---|---|
| `memory_boot` | returns state + top memories in one compact block (~350 token budget) |
| `remember(text, tags?)` | saves one short fact as `unverified` (max 300 chars, near-duplicates ignored) |
| `recall(query)` | BM25 keyword search, max 3 results |
| `search_chats(query)` | searches your past LM Studio chats, max 3 results |
| `state_set(key, value)` | small key-value state, empty value clears |

## Suggested system prompt (keep it this short)

```txt
You have memory tools. At the start of a conversation call memory_boot once.
Use recall before answering questions about past work or preferences.
Use search_chats when the user refers to an earlier conversation.
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

## Past conversations (history module)
`src/history.js` reads LM Studio's saved chats and makes them searchable. It is **read-only**: nothing is ever written into LM Studio's folder.

- Default folder: `~/.lmstudio/conversations` (Windows: `%USERPROFILE%\.lmstudio\conversations`). Override with the `LMSTUDIO_CONVERSATIONS` environment variable.
- LM Studio's file format is undocumented and may change. The parser is tolerant: it skips what it cannot read, ignores thinking, tool and system content, and never crashes the server.
- It builds a small cached index (`chats-index.json` in `MEMORY_DIR`) and only re-reads files that changed.
- The newest chat (saved in the last 10 minutes) is skipped so the model does not "recall" the conversation it is in. Change with `CHAT_EXCLUDE_MINUTES` (0 turns it off).
- Each result is one question and reply, trimmed to about 240 characters each.

CLI:
```ps
node src/cli.js chats              # list indexed conversations
node src/cli.js chat-search <q>    # search them (includes the newest chat)
node src/cli.js reindex            # rebuild the index from scratch
node src/cli.js inspect [file]     # print the JSON key structure of a chat file, no message text
```

If search returns nothing for chats you know exist, run `inspect` and send me the output: that is how we adapt the parser to your LM Studio version.
