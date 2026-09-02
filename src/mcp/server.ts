#!/usr/bin/env node
/**
 * The MCP server — what Claude connects to.
 *
 * A thin adapter: it registers the shared tool contract and serialises results.
 * All validation, ordering and graph logic lives behind `src/tools/contract`,
 * so this file has no opinions of its own and the on-site agent loop gets the
 * same behaviour for free.
 *
 * Transport is stdio, which is what Claude Desktop launches directly. A remote
 * streamable-HTTP deployment reuses everything here apart from the last block.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadOntology, openGraph, type Graph } from "../graph/db";
import { buildTools } from "../tools/contract";

const GRAPH_PATH = process.env.GRAPH_PATH ?? "./data/demo";
const ONTOLOGY_PATH = process.env.ONTOLOGY_PATH ?? "ontology/base.yaml";

export async function createServer(graph: Graph): Promise<McpServer> {
  const server = new McpServer(
    { name: "ontologenius", version: "0.1.0" },
    {
      instructions:
        "Build and study ontology-governed knowledge graphs.\n\n" +
        "To build a topic: call open_scheme, then add_concepts (each needs a source), then relate " +
        "them with PREREQUISITE_OF so a learning path exists, then add_items so the concepts can " +
        "actually be studied. A concept with no items can never be mastered and blocks everything " +
        "downstream of it.\n\n" +
        "Writes are checked against the ontology. Nothing throws: each call reports what it accepted " +
        "and what it rejected with reasons, so read the rejections and resend corrected input.\n\n" +
        "Before extending an existing topic, call progress — it reports the learner's weakest concepts " +
        "and which concepts still lack questions.",
    },
  );

  for (const tool of buildTools(graph.ontology)) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
      async (args: Record<string, unknown>) => {
        try {
          const result = await tool.handler(graph, args);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (error) {
          // Surface the failure to the model rather than killing the connection:
          // a malformed call is something it can correct on the next turn.
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `${tool.name} failed: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
          };
        }
      },
    );
  }

  return server;
}

async function main() {
  const graph = await openGraph(GRAPH_PATH, loadOntology(ONTOLOGY_PATH));
  const server = await createServer(graph);
  await server.connect(new StdioServerTransport());
  // stdout carries the protocol; anything human-readable has to go to stderr.
  console.error(`ontologenius MCP server ready (graph: ${GRAPH_PATH})`);
}

// Only run when executed directly, so tests can import createServer.
if (process.argv[1]?.includes("mcp/server")) {
  main().catch((error) => {
    console.error("failed to start:", error);
    process.exit(1);
  });
}
