import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "memtest-"));
process.env.MEMORY_DIR = tmp;
const { readAll, search, compact, writeAll } = await import("../src/store.js");
const { remember, setStatus } = await import("../src/log.js");
const { stateSet, stateGet } = await import("../src/state.js");
const { buildBoot } = await import("../src/boot.js");
const reset = () => { writeAll([]); fs.rmSync(path.join(tmp, "state.json"), { force: true }); };

test("remember saves, rejects junk, and dedupes", () => {
  reset();
  assert.equal(remember("hi").ok, false);
  assert.equal(remember("x".repeat(400)).ok, false);
  const a = remember("User runs Gemma 4 e4b in LM Studio on a CPU-only laptop", "Setup, LM-Studio");
  assert.ok(a.ok && !a.duplicate);
  const b = remember("User runs Gemma 4 e4b in LM Studio on a CPU only laptop");
  assert.ok(b.duplicate, "near-duplicate should be caught");
  assert.equal(readAll().length, 1);
  assert.deepEqual(readAll()[0].tags, ["setup", "lm-studio"]);
  assert.equal(readAll()[0].status, "unverified");
});

test("recall ranks relevant entries first and hides rejected", () => {
  reset();
  remember("Project Forge is a browser launch console built on Node and Express");
  remember("Prefill speed on CPU is slow so keep prompts short");
  remember("Favourite editor is VS Code");
  const hits = search("cpu prompt speed", readAll());
  assert.match(hits[0].text, /Prefill/);
  const id = readAll().find((e) => /Prefill/.test(e.text)).id;
  setStatus(id, "rejected");
  assert.equal(search("cpu prompt speed", readAll()).length, 0);
});

test("verified entries outrank unverified on equal text match", () => {
  reset();
  remember("alpha beta gamma delta one");
  remember("alpha beta gamma delta two");
  const second = readAll()[1].id;
  setStatus(second, "verified");
  assert.equal(search("alpha beta gamma delta", readAll())[0].id, second);
});

test("state set/get/clear and key cap", () => {
  reset();
  assert.ok(stateSet("Current Task", "build memory server").ok);
  assert.equal(stateGet("current_task"), "build memory server");
  stateSet("current_task", "");
  assert.equal(stateGet("current_task"), null);
  for (let i = 0; i < 30; i++) stateSet("k" + i, "v");
  assert.equal(stateSet("overflow", "v").ok, false);
});

test("boot respects the token budget and marks unverified", () => {
  reset();
  stateSet("task", "tests");
  for (let i = 0; i < 60; i++) remember(`distinct fact number ${i} about topic${i} with padding words here`);
  setStatus(readAll()[0].id, "verified");
  const out = buildBoot({ budget: 120 });
  assert.ok(Math.ceil(out.length / 4) <= 135, `boot too large: ${out.length} chars`);
  assert.match(out, /STATE: task=tests/);
  assert.match(out, /\(\?\)/);
});

test("compact drops dupes, rejected, and expired unverified", () => {
  reset();
  const old = Date.now() - 40 * 86400000;
  writeAll([
    { id: "a1", ts: Date.now(), text: "same fact about cpu inference speed here", tags: [], status: "verified" },
    { id: "a2", ts: Date.now(), text: "same fact about cpu inference speed here again", tags: [], status: "unverified" },
    { id: "a3", ts: old, text: "ancient unverified note about something", tags: [], status: "unverified" },
    { id: "a4", ts: Date.now(), text: "bad claim", tags: [], status: "rejected" },
    { id: "a5", ts: old, text: "ancient but verified stays forever", tags: [], status: "verified" },
  ]);
  const r = compact();
  assert.equal(r.after, 2);
  assert.deepEqual(readAll().map((e) => e.id).sort(), ["a1", "a5"]);
});

test("corrupt line is skipped, not fatal", () => {
  reset();
  fs.appendFileSync(path.join(tmp, "memory.jsonl"), "{not json\n");
  remember("a valid entry after corruption");
  assert.equal(readAll().length, 1);
});

test("MCP server end-to-end over stdio", async () => {
  reset();
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const server = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/server.js");
  const client = new Client({ name: "t", version: "0" });
  await client.connect(new StdioClientTransport({ command: "node", args: [server], env: { ...process.env, MEMORY_DIR: tmp } }));
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map((t) => t.name).sort(), ["memory_boot", "recall", "remember", "state_set"]);
  const schemaChars = JSON.stringify(tools).length;
  console.log(`  tool schema size: ${schemaChars} chars (~${Math.ceil(schemaChars / 4)} tokens)`);
  const call = async (name, args = {}) => (await client.callTool({ name, arguments: args })).content[0].text;
  assert.equal(await call("memory_boot"), "No memory yet.");
  assert.match(await call("remember", { text: "Target runtime is LM Studio with Gemma 4 e4b", tags: "setup" }), /saved/);
  assert.match(await call("state_set", { key: "phase", value: "step 2" }), /set phase/);
  assert.match(await call("recall", { query: "gemma runtime" }), /LM Studio/);
  const boot = await call("memory_boot");
  assert.match(boot, /STATE: phase=step 2/);
  assert.match(boot, /\(\?\) Target runtime/);
  await client.close();
});

test("recall tolerates US/UK spelling and plurals", () => {
  reset();
  remember("My favourite colour is blue");
  for (const q of ["favorite color", "what is my favorite color?", "colors", "favourite colour"]) {
    assert.equal(search(q, readAll()).length, 1, `query failed: ${q}`);
  }
  remember("I organise my notes and was running tests");
  assert.equal(search("organize note run test", readAll()).length >= 1, true);
});
  
test("generic words alone do not create false matches", () => {
  reset();
  remember("My favourite colour is blue");
  assert.equal(search("what is my name", readAll()).length, 0);
});