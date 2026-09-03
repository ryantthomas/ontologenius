/**
 * The deployed process: the site and the remote MCP connector, together.
 *
 * They have to share a process. The graph is an embedded single-writer
 * database, so two services behind one volume would corrupt or block each
 * other; one process holding one handle is the only arrangement that works.
 * Express owns the routes that need Node's req/res (the MCP transport does),
 * and everything else falls through to Next.
 */
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import express from "express";
import next from "next";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { backupGraph } from "./src/graph/backup";
import { loadOntology, openGraph } from "./src/graph/db";
import { createServer as createMcpServer } from "./src/mcp/server";
import { OntologeniusOAuthProvider } from "./src/mcp/oauth";

const PORT = Number(process.env.PORT ?? 3000);
const dev = process.env.NODE_ENV !== "production";

/** The externally reachable origin. Cloud Run knows it; locally we guess. */
const publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`;

async function main() {
  const graphPath = process.env.GRAPH_PATH ?? "./data/demo";
  const graph = await openGraph(
    graphPath,
    loadOntology(process.env.ONTOLOGY_PATH ?? "ontology/base.yaml"),
  );

  // Default backups next to the graph, so on a deployment they land on the
  // mounted volume rather than in a container layer that vanishes on restart.
  const backupRoot = process.env.BACKUP_DIR ?? join(dirname(graphPath), "backups");

  const app = express();
  const nextApp = next({ dev });
  const handleNext = nextApp.getRequestHandler();
  await nextApp.prepare();

  const secret = process.env.OAUTH_SECRET;

  if (secret) {
    const provider = new OntologeniusOAuthProvider(secret, process.env.LEARNER_ID ?? "me");

    // Metadata, authorize, token, and dynamic client registration. claude.ai
    // discovers all of it from the well-known endpoints this mounts.
    app.use(
      mcpAuthRouter({
        provider,
        issuerUrl: new URL(publicUrl),
        resourceName: "Ontologenius",
      }),
    );

    app.post(
      "/mcp",
      requireBearerAuth({ verifier: provider }),
      express.json(),
      async (request, response) => {
        // Stateless: a transport per request, so no session state to lose when
        // Cloud Run scales the instance down between calls.
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        const server = await createMcpServer(graph);

        response.on("close", () => {
          void transport.close();
          void server.close();
        });

        await server.connect(transport);
        await transport.handleRequest(request, response, request.body);
      },
    );

    /**
     * Back up without stopping the server.
     *
     * The engine is single-writer and holds a file lock, so a separate
     * `npm run backup` process cannot open a graph this server already has
     * open. The only process that *can* back up a live deployment is this one,
     * which is why the operation is reachable over HTTP rather than from a
     * shell.
     *
     * Guarded by the same bearer auth as the connector: this is single-tenant,
     * so the operator and the learner are the same person holding the same
     * token.
     */
    app.post(
      "/admin/backup",
      requireBearerAuth({ verifier: provider }),
      async (_request, response) => {
        try {
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          const result = await backupGraph(graph, join(backupRoot, stamp));
          response.json({ path: result.path, files: result.files.length });
        } catch (error) {
          response
            .status(500)
            .json({ error: error instanceof Error ? error.message : "backup failed" });
        }
      },
    );
  } else {
    // Refusing to serve is better than serving an unauthenticated write path
    // to the public internet.
    app.all("/mcp", (_request, response) => {
      response.status(503).json({
        error: "The remote connector is disabled because OAUTH_SECRET is not set.",
      });
    });
  }

  app.use((request, response) => {
    void handleNext(request, response);
  });

  createServer(app).listen(PORT, () => {
    console.log(`ontologenius on ${publicUrl}`);
    console.log(secret ? "remote connector: enabled at /mcp" : "remote connector: disabled");
  });
}

main().catch((error) => {
  console.error("failed to start:", error);
  process.exit(1);
});
