#!/usr/bin/env node
// One MCP server, four tiny tools. Descriptions are deliberately short:
// every word here is re-processed by the model on every turn.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readAll, search } from "./store.js";
import { remember } from "./log.js";
import { stateSet } from "./state.js";
import { buildBoot } from "./boot.js";

const server = new McpServer({ name: "memory", version: "0.1.0" });
const text = (t) => ({ content: [{ type: "text", text: t }] });

server.registerTool(
  "memory_boot",
  { description: "Load saved memory and state. Call once at session start." },
  async () => text(buildBoot())
);

server.registerTool(
  "remember",
  {
    description: "Save one short fact worth keeping.",
    inputSchema: { text: z.string().describe("one fact, under 300 chars"), tags: z.string().optional().describe("comma-separated, max 5") },
  },
  async ({ text: t, tags }) => text(remember(t, tags).msg)
);

server.registerTool(
  "recall",
  { description: "Search saved memory by keywords.", inputSchema: { query: z.string() } },
  async ({ query }) => {
    const all = readAll();
    const line = (e) => `- ${e.status === "verified" ? "" : "(?) "}${e.text}`;
    const hits = search(query, all, { limit: 3 });
    if (hits.length) return text(hits.map(line).join("\n"));
    // No keyword match: show the newest entries so the model can judge, instead of giving up.
    const recent = all.filter((e) => e.status !== "rejected").sort((a, b) => b.ts - a.ts).slice(0, 3);
    return text(recent.length ? "no exact match. recent entries:\n" + recent.map(line).join("\n") : "memory is empty");
  }
);

server.registerTool(
  "state_set",
  { description: "Set a small state value. Empty value clears it.", inputSchema: { key: z.string(), value: z.string() } },
  async ({ key, value }) => text(stateSet(key, value).msg)
);

await server.connect(new StdioServerTransport());
