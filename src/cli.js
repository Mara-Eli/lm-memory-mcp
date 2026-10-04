#!/usr/bin/env node
// CLI: the human + background-job side. The model never calls these.
import { readAll, compact, search, memoryDir, readState } from "./store.js";
import { setStatus, remember } from "./log.js";
import { buildBoot } from "./boot.js";
import fs from "node:fs";
import { conversationsDirs, listConversationFiles, buildIndex, searchChats, formatHits, shapeOf } from "./history.js";

const [cmd, ...args] = process.argv.slice(2);
const fmt = (e) => `${e.id}  [${e.status.padEnd(10)}] ${e.text}${e.tags?.length ? "  #" + e.tags.join(" #") : ""}`;

switch (cmd) {
  case "list": {
    const filter = args[0];
    const all = readAll().filter((e) => !filter || e.status === filter);
    console.log(all.length ? all.map(fmt).join("\n") : "(empty)");
    break;
  }
  case "approve": case "reject": {
    if (!args.length) { console.log(`usage: ${cmd} <id> [id...]`); break; }
    for (const id of args) console.log(id, setStatus(id, cmd === "approve" ? "verified" : "rejected") ? "ok" : "not found");
    break;
  }
  case "add": console.log(remember(args.join(" "), "manual").msg); break;
  case "search": console.log(search(args.join(" "), readAll(), { limit: 5 }).map(fmt).join("\n") || "nothing found"); break;
  case "boot": console.log(buildBoot()); break;
  case "compact": console.log(compact()); break;
  case "stats": {
    const all = readAll();
    const by = (s) => all.filter((e) => e.status === s).length;
    console.log({ dir: memoryDir(), total: all.length, verified: by("verified"), unverified: by("unverified"), rejected: by("rejected"), stateKeys: Object.keys(readState()).length });
    break;
  }
  case "chats": {
    console.log("folders:", conversationsDirs().join(", ") || "(none found, set LMSTUDIO_CONVERSATIONS)");
    const { idx } = buildIndex();
    const rows = Object.entries(idx.files).sort((a, b) => b[1].mtimeMs - a[1].mtimeMs);
    console.log(rows.map(([f, x]) => `${new Date(x.mtimeMs).toISOString().slice(0, 16)}  ${String(x.chunks.length).padStart(3)} exch  ${x.failed ? "(unreadable) " : ""}${x.title}`).join("\n") || "(no conversations)");
    break;
  }
  case "reindex": console.log(buildIndex({ force: true }).stats); break;
  case "chat-search": console.log(formatHits(searchChats(args.join(" "), { limit: 5, excludeRecentMinutes: 0 }))); break;
  case "inspect": {
    // Prints the key structure of a conversation file, with no message text.
    const file = args[0] || listConversationFiles()[0];
    if (!file) { console.log("no conversation files found"); break; }
    console.log(file);
    console.log(JSON.stringify(shapeOf(JSON.parse(fs.readFileSync(file, "utf8"))), null, 1));
    break;
  }
  default:
    console.log("commands: chats | reindex | chat-search <q> | inspect [file] | list [status] | approve <id..> | reject <id..> | add <text> | search <q> | boot | compact | stats");
}
