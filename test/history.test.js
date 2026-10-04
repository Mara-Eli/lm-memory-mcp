import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hist-"));
const convDir = path.join(root, "conversations");
const memDir = path.join(root, "mem");
fs.mkdirSync(path.join(convDir, "sub"), { recursive: true });
process.env.MEMORY_DIR = memDir;
process.env.LMSTUDIO_CONVERSATIONS = convDir;
delete process.env.CHAT_EXCLUDE_MINUTES;

const { buildIndex, searchChats, formatHits, parseConversation } = await import("../src/history.js");

const old = (file, daysAgo = 3) => {
  const t = new Date(Date.now() - daysAgo * 86400000);
  fs.utimesSync(file, t, t);
};
const write = (rel, obj, raw) => {
  const f = path.join(convDir, rel);
  fs.writeFileSync(f, raw ?? JSON.stringify(obj));
  return f;
};

// Shape 1: versions[] + steps with a thinking block (best-guess LM Studio shape)
const A = write("1727000000001.conversation.json", {
  name: "Forge proxy planning",
  messages: [
    { versions: [{ type: "singleStep", role: "user", content: [{ type: "text", text: "How should I structure the Forge proxy?" }] }], currentlySelected: 0 },
    { versions: [{ type: "multiStep", role: "assistant", steps: [
      { type: "contentBlock", style: { type: "thinking" }, content: [{ type: "text", text: "SECRETTHINK reasoning here" }] },
      { type: "contentBlock", content: [{ type: "text", text: "Put the proxy behind a small express router." }] },
    ] }], currentlySelected: 0 },
  ],
});
// Shape 2: flat messages, string content, inline <think>, in a subfolder
const B = write("sub/1727000000002.conversation.json", {
  title: "Tomato notes",
  messages: [
    { role: "user", content: "What soil do tomatoes need?" },
    { role: "assistant", content: "<think>HIDDENTHINK</think>Well drained loam with compost." },
    { role: "system", content: "SYSTEMTEXT should never be indexed" },
  ],
});
const C = write("1727000000003.conversation.json", null, "{ this is not json");
const D = write("1727000000004.conversation.json", {
  name: "Live chat",
  messages: [{ role: "user", content: "zebra migration patterns" }, { role: "assistant", content: "Zebras migrate seasonally." }],
});
[A, B, C].forEach((f) => old(f)); // D keeps a fresh mtime: it is "the current chat"

test("parser extracts text, skips thinking, tools and system messages", () => {
  const a = parseConversation(fs.readFileSync(A, "utf8"));
  assert.equal(a.title, "Forge proxy planning");
  assert.equal(a.chunks.length, 1);
  assert.match(a.chunks[0].reply, /express router/);
  assert.doesNotMatch(JSON.stringify(a), /SECRETTHINK/);
  const b = parseConversation(fs.readFileSync(B, "utf8"));
  assert.equal(b.title, "Tomato notes");
  assert.doesNotMatch(JSON.stringify(b), /HIDDENTHINK|SYSTEMTEXT/);
  assert.match(b.chunks[0].reply, /loam/);
});

test("selected version is used when a message has several versions", () => {
  const raw = JSON.stringify({ messages: [{ versions: [
    { role: "user", content: "first draft" }, { role: "user", content: "edited question about kayaks" }], currentlySelected: 1 }] });
  assert.match(parseConversation(raw).chunks[0].user, /kayaks/);
});

test("index finds files recursively and survives a corrupt file", () => {
  const { stats, idx } = buildIndex({ force: true });
  assert.equal(stats.scanned, 4);
  assert.equal(stats.failed, 1);
  assert.equal(Object.keys(idx.files).length, 4);
});

test("search returns past chats, newest chat excluded by default", () => {
  const proxy = searchChats("proxy router");
  assert.equal(proxy.length, 1);
  assert.equal(proxy[0].title, "Forge proxy planning");
  assert.match(formatHits(proxy), /express router/);
  assert.equal(searchChats("tomato soil")[0].title, "Tomato notes");
  assert.equal(searchChats("zebra migration").length, 0, "current chat must be excluded");
  assert.equal(searchChats("zebra migration", { excludeRecentMinutes: 0 }).length, 1);
  assert.equal(formatHits(searchChats("nonexistent quantum")), "no matching past chats");
});

test("indexing is incremental: only changed files are re-parsed", () => {
  assert.equal(buildIndex().stats.reparsed, 0);
  const obj = JSON.parse(fs.readFileSync(A, "utf8"));
  obj.messages.push({ role: "user", content: "also add rate limiting to the proxy" });
  fs.writeFileSync(A, JSON.stringify(obj));
  old(A);
  assert.equal(buildIndex().stats.reparsed, 1);
  assert.ok(searchChats("rate limiting").length >= 1);
});

test("deleted conversations drop out of the index", () => {
  fs.rmSync(B);
  assert.equal(buildIndex().stats.removed, 1);
  assert.equal(searchChats("tomato soil").length, 0);
});

test("missing conversations folder is harmless", async () => {
  process.env.LMSTUDIO_CONVERSATIONS = path.join(root, "does-not-exist");
  assert.equal(buildIndex({ force: true }).stats.scanned, 0);
  assert.equal(searchChats("anything").length, 0);
  process.env.LMSTUDIO_CONVERSATIONS = convDir;
});

test("search_chats works through the real MCP server", async () => {
  buildIndex({ force: true });
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const server = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/server.js");
  const client = new Client({ name: "t", version: "0" });
  await client.connect(new StdioClientTransport({ command: "node", args: [server], env: { ...process.env } }));
  const out = (await client.callTool({ name: "search_chats", arguments: { query: "proxy router" } })).content[0].text;
  assert.match(out, /Forge proxy planning/);
  assert.match(out, /express router/);
  assert.doesNotMatch(out, /SECRETTHINK/);
  const tools = (await client.listTools()).tools;
  const chars = JSON.stringify(tools).length;
  console.log(`  total tool schema: ${tools.length} tools, ${chars} chars (~${Math.ceil(chars / 4)} tokens)`);
  await client.close();
});