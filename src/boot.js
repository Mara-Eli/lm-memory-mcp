// boot: builds the compact start-up block. Pure code, no model involved.
import { readAll, readState } from "./store.js";

const approxTokens = (s) => Math.ceil(s.length / 4);

export function buildBoot({ budget = 350 } = {}) {
  const lines = [];
  const state = readState();
  const stateLines = Object.entries(state).map(([k, v]) => `${k}=${v}`);
  if (stateLines.length) lines.push("STATE: " + stateLines.join("; "));

  const mem = readAll().filter((e) => e.status !== "rejected");
  // verified first, then newest unverified
  const ranked = [
    ...mem.filter((e) => e.status === "verified").sort((a, b) => b.ts - a.ts),
    ...mem.filter((e) => e.status === "unverified").sort((a, b) => b.ts - a.ts),
  ];
  let used = approxTokens(lines.join("\n"));
  const memLines = [];
  for (const e of ranked) {
    const line = `- ${e.status === "verified" ? "" : "(?) "}${e.text}`;
    const cost = approxTokens(line) + 1;
    if (used + cost > budget) break;
    memLines.push(line);
    used += cost;
  }
  if (memLines.length) lines.push("MEMORY:\n" + memLines.join("\n"));
  return lines.length ? lines.join("\n") : "No memory yet.";
}
