// state: the "stateful memory" role. A tiny key-value map.
import { readState, writeState } from "./store.js";

const MAX_KEYS = 30, MAX_VAL = 200;

export function stateSet(key, value) {
  key = String(key || "").trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "_").slice(0, 40);
  if (!key) return { ok: false, msg: "empty key" };
  const s = readState();
  if (value === "" || value == null) {
    delete s[key];
    writeState(s);
    return { ok: true, msg: `cleared ${key}` };
  }
  if (!(key in s) && Object.keys(s).length >= MAX_KEYS) return { ok: false, msg: "state full, clear a key first" };
  s[key] = String(value).slice(0, MAX_VAL);
  writeState(s);
  return { ok: true, msg: `set ${key}` };
}

export function stateGet(key) {
  const s = readState();
  return key ? s[String(key).toLowerCase()] ?? null : s;
}
