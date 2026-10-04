// history: lets the model search past LM Studio chats.
//
// READ-ONLY on LM Studio's files. We never write into the conversations folder.
// LM Studio's chat JSON is undocumented and may change, so the parser is tolerant:
// it understands the shapes we know about, skips what it can't read, and never throws.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { memoryDir, search } from "./store.js";

const MAX_USER = 240, MAX_REPLY = 240, MAX_DEPTH = 5;

// ---------- locating the files ----------
export function conversationsDirs() {
  if (process.env.LMSTUDIO_CONVERSATIONS) return [process.env.LMSTUDIO_CONVERSATIONS];
  const h = os.homedir();
  return [path.join(h, ".lmstudio", "conversations"), path.join(h, ".cache", "lm-studio", "conversations")].filter((d) =>
    fs.existsSync(d)
  );
}

export function listConversationFiles() {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile() && /\.conversation\.json$/i.test(e.name)) out.push(p);
    }
  };
  for (const d of conversationsDirs()) walk(d, 0);
  return out;
}

// ---------- tolerant parsing ----------
const SKIP_TYPE = /think|reason|tool|image|file|result|call|debug/i;

function textOf(c) {
  if (c == null) return "";
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map(textOf).filter(Boolean).join("\n");
  if (typeof c === "object") {
    if (SKIP_TYPE.test(String(c.type || ""))) return "";
    if (typeof c.text === "string") return c.text;
    if (c.content !== undefined) return textOf(c.content);
  }
  return "";
}

function messageText(v) {
  const parts = [];
  if (v.content !== undefined) parts.push(textOf(v.content));
  if (Array.isArray(v.steps)) {
    for (const st of v.steps) {
      if (!st || typeof st !== "object") continue;
      const sig = String(st.type || "") + JSON.stringify(st.style || "");
      if (SKIP_TYPE.test(sig)) continue; // drop thinking / tool / debug steps
      parts.push(textOf(st.content));
    }
  }
  return parts
    .join("\n")
    .replace(/<think>[\s\S]*?<\/think>/gi, "") // some models inline their reasoning
    .replace(/\s+/g, " ")
    .trim();
}

export function parseConversation(raw) {
  const obj = JSON.parse(raw);
  const list = Array.isArray(obj?.messages) ? obj.messages : [];
  const msgs = [];
  for (const m of list) {
    if (!m || typeof m !== "object") continue;
    let v = m;
    if (Array.isArray(m.versions) && m.versions.length) {
      const i = Number.isInteger(m.currentlySelected) ? m.currentlySelected : m.versions.length - 1;
      v = m.versions[i] ?? m.versions[m.versions.length - 1];
    }
    const role = String(v.role ?? m.role ?? "").toLowerCase();
    if (role !== "user" && role !== "assistant") continue;
    const text = messageText(v);
    if (text) msgs.push({ role, text });
  }
  // Pair each user message with the first assistant reply that follows it.
  const chunks = [];
  let cur = null;
  for (const m of msgs) {
    if (m.role === "user") {
      if (cur) chunks.push(cur);
      cur = { user: m.text.slice(0, MAX_USER), reply: "" };
    } else if (!cur) {
      cur = { user: "", reply: m.text.slice(0, MAX_REPLY) };
    } else if (!cur.reply) {
      cur.reply = m.text.slice(0, MAX_REPLY);
    }
  }
  if (cur) chunks.push(cur);
  const firstUser = msgs.find((m) => m.role === "user")?.text || "";
  const title = String(obj?.name || obj?.title || firstUser.slice(0, 50) || "untitled").slice(0, 80);
  return { title, chunks };
}

// ---------- incremental index ----------
const indexPath = () => path.join(memoryDir(), "chats-index.json");

function loadIndex() {
  try {
    const j = JSON.parse(fs.readFileSync(indexPath(), "utf8"));
    if (j && j.files) return j;
  } catch {}
  return { files: {} };
}

export function buildIndex({ force = false } = {}) {
  const idx = force ? { files: {} } : loadIndex();
  const stats = { scanned: 0, reparsed: 0, failed: 0, removed: 0 };
  const seen = new Set();
  for (const file of listConversationFiles()) {
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }
    stats.scanned++;
    seen.add(file);
    const prev = idx.files[file];
    if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) continue; // unchanged
    stats.reparsed++;
    try {
      const { title, chunks } = parseConversation(fs.readFileSync(file, "utf8"));
      idx.files[file] = { mtimeMs: st.mtimeMs, size: st.size, title, chunks };
    } catch {
      idx.files[file] = { mtimeMs: st.mtimeMs, size: st.size, title: "", chunks: [], failed: true };
      stats.failed++;
    }
  }
  for (const f of Object.keys(idx.files)) {
    if (!seen.has(f)) {
      delete idx.files[f];
      stats.removed++;
    }
  }
  const tmp = indexPath() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(idx));
  fs.renameSync(tmp, indexPath());
  return { idx, stats };
}

// ---------- search ----------
const dateOf = (file, mtimeMs) => {
  const m = path.basename(file).match(/^(\d{13})/);
  return new Date(m ? Number(m[1]) : mtimeMs).toISOString().slice(0, 10);
};

export function searchChats(query, { limit = 3, excludeRecentMinutes } = {}) {
  const exclude = excludeRecentMinutes ?? Number(process.env.CHAT_EXCLUDE_MINUTES ?? 10);
  const { idx } = buildIndex();
  const now = Date.now();
  const pool = [];
  for (const [file, f] of Object.entries(idx.files)) {
    // The chat you are in right now is the most recently saved file; skip it.
    if (exclude > 0 && now - f.mtimeMs < exclude * 60000) continue;
    f.chunks.forEach((c, i) =>
      pool.push({ id: `${file}#${i}`, text: `${f.title} ${c.user} ${c.reply}`, status: "chat", tags: [], _f: f, _c: c, _file: file })
    );
  }
  return search(query, pool, { limit }).map((e) => ({
    date: dateOf(e._file, e._f.mtimeMs),
    title: e._f.title,
    user: e._c.user,
    reply: e._c.reply,
  }));
}

export function formatHits(hits) {
  if (!hits.length) return "no matching past chats";
  return hits
    .map((h) => `- ${h.date} "${h.title}" | You: ${h.user} | Reply: ${h.reply}`.slice(0, 520))
    .join("\n");
}

// Shows the key structure of one file (no message content) so we can adapt the parser.
export function shapeOf(value, depth = 0) {
  if (depth > 5) return "…";
  if (Array.isArray(value)) return value.length ? [`array(${value.length}) of`, shapeOf(value[0], depth + 1)] : "array(0)";
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shapeOf(v, depth + 1)]));
  return typeof value === "string" ? `string(${value.length})` : typeof value;
}
