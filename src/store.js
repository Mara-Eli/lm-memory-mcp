// store: the "create / manage / optimise" role.
// Plain files, no database, no embeddings. Cheap on a CPU.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export function memoryDir() {
  const dir = process.env.MEMORY_DIR || path.join(os.homedir(), ".lm-memory");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const files = () => {
  const d = memoryDir();
  return { mem: path.join(d, "memory.jsonl"), state: path.join(d, "state.json") };
};

// ---------- entries ----------
export function readAll() {
  const { mem } = files();
  if (!fs.existsSync(mem)) return [];
  return fs
    .readFileSync(mem, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null; // skip a corrupt line instead of dying
      }
    })
    .filter(Boolean);
}

// Atomic rewrite: write temp, then rename. A crash never leaves a half file.
export function writeAll(entries) {
  const { mem } = files();
  const tmp = mem + ".tmp";
  fs.writeFileSync(tmp, entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : ""));
  fs.renameSync(tmp, mem);
}

export function appendEntry(entry) {
  fs.appendFileSync(files().mem, JSON.stringify(entry) + "\n");
}

export const newId = () => crypto.randomBytes(3).toString("hex");

// ---------- tokenising + BM25 ----------
const STOP = new Set(
  "a an the and or but if of to in on at for with is are was were be been it this that as by from i you we they he she not do does did".split(" ")
);
export function tokens(s) {
  return (s.toLowerCase().match(/[a-z0-9_]+/g) || []).filter((t) => t.length > 1 && !STOP.has(t));
}

export function search(query, entries, { limit = 3, includeUnverified = true } = {}) {
  const pool = entries.filter((e) => e.status !== "rejected" && (includeUnverified || e.status === "verified"));
  const q = tokens(query);
  if (!q.length || !pool.length) return [];
  const docs = pool.map((e) => tokens(e.text + " " + (e.tags || []).join(" ")));
  const N = docs.length;
  const avg = docs.reduce((a, d) => a + d.length, 0) / N || 1;
  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  const k1 = 1.5, b = 0.75;
  const scored = pool.map((e, i) => {
    const d = docs[i];
    const tf = new Map();
    for (const t of d) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avg));
    }
    if (e.status === "verified") score *= 1.25; // trust verified entries more
    return { e, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.e);
}

// Jaccard overlap, used for near-duplicate detection.
export function similarity(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

// ---------- state ----------
export function readState() {
  const { state } = files();
  if (!fs.existsSync(state)) return {};
  try {
    return JSON.parse(fs.readFileSync(state, "utf8"));
  } catch {
    return {};
  }
}
export function writeState(obj) {
  const { state } = files();
  const tmp = state + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, state);
}

// ---------- compaction (runs from the CLI, never from the model) ----------
export function compact({ maxEntries = 500, dupThreshold = 0.8, unverifiedTtlDays = 30 } = {}) {
  const before = readAll();
  const now = Date.now();
  const dayMs = 86400000;
  const kept = [];
  let dupes = 0, expired = 0, rejectedDropped = 0;
  // Verified first so they win duplicate contests.
  const order = [...before].sort((a, b) => (b.status === "verified") - (a.status === "verified") || b.ts - a.ts);
  for (const e of order) {
    if (e.status === "rejected") { rejectedDropped++; continue; }
    if (e.status === "unverified" && now - e.ts > unverifiedTtlDays * dayMs) { expired++; continue; }
    if (kept.some((k) => similarity(k.text, e.text) >= dupThreshold)) { dupes++; continue; }
    kept.push(e);
  }
  // Hard cap: drop the oldest unverified first.
  let capped = 0;
  while (kept.length > maxEntries) {
    const idx = kept.map((e, i) => [e, i]).filter(([e]) => e.status !== "verified").sort((a, b) => a[0].ts - b[0].ts)[0];
    if (!idx) break;
    kept.splice(idx[1], 1);
    capped++;
  }
  kept.sort((a, b) => a.ts - b.ts);
  writeAll(kept);
  return { before: before.length, after: kept.length, dupes, expired, rejectedDropped, capped };
}
