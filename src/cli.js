#!/usr/bin/env node
// CLI: the human + background-job side. The model never calls these.
import { readAll, compact, search, memoryDir, readState } from "./store.js";
import { setStatus, remember } from "./log.js";
import { buildBoot } from "./boot.js";

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
  default:
    console.log("commands: list [status] | approve <id..> | reject <id..> | add <text> | search <q> | boot | compact | stats");
}
