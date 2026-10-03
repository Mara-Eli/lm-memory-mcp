// log: the "write useful info to memory" role.
import { readAll, writeAll, appendEntry, newId, similarity } from "./store.js";

export const MAX_TEXT = 300; // keep entries small: they get pasted into prompts later

export function remember(text, tags = "") {
  text = String(text || "").trim().replace(/\s+/g, " ");
  if (text.length < 5) return { ok: false, msg: "too short" };
  if (text.length > MAX_TEXT) return { ok: false, msg: `too long (max ${MAX_TEXT} chars), shorten it` };
  const tagList = String(tags || "")
    .split(/[,\s]+/)
    .map((t) => t.toLowerCase().replace(/[^a-z0-9_-]/g, ""))
    .filter(Boolean)
    .slice(0, 5);
  const existing = readAll();
  const dup = existing.find((e) => e.status !== "rejected" && similarity(e.text, text) >= 0.8);
  if (dup) return { ok: true, msg: `already known (${dup.id})`, id: dup.id, duplicate: true };
  const entry = { id: newId(), ts: Date.now(), text, tags: tagList, status: "unverified" };
  appendEntry(entry);
  return { ok: true, msg: `saved ${entry.id}`, id: entry.id };
}

export function setStatus(id, status) {
  if (!["verified", "unverified", "rejected"].includes(status)) throw new Error("bad status");
  const all = readAll();
  const hit = all.find((e) => e.id === id);
  if (!hit) return false;
  hit.status = status;
  writeAll(all);
  return true;
}
