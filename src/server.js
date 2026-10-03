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
    const hits = search(query, readAll(), { limit: 3 });
    return text(hits.length ? hits.map((e) => `- ${e.status === "verified" ? "" : "(?) "}${e.text}`).join("\n") : "nothing found");
  }
);

server.registerTool(
  "state_set",
  { description: "Set a small state value. Empty value clears it.", inputSchema: { key: z.string(), value: z.string() } },
  async ({ key, value }) => text(stateSet(key, value).msg)
);

await server.connect(new StdioServerTransport());
