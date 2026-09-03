/**
 * Back the graph up before anything that could lose it — chiefly an engine
 * upgrade, which rewrites the on-disk format in place and cannot be undone.
 *
 *   npm run backup                       -> ./backups/<timestamp>
 *   npm run backup -- ./somewhere/else
 */
import { backupGraph } from "../src/graph/backup";
import { loadOntology, openGraph } from "../src/graph/db";
import lbug from "@ladybugdb/core";

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = process.argv[2] ?? `./backups/${stamp}`;

let graph;
try {
  graph = await openGraph(
    process.env.GRAPH_PATH ?? "./data/demo",
    loadOntology(process.env.ONTOLOGY_PATH ?? "ontology/base.yaml"),
  );
} catch (error) {
  // The engine is single-writer. A running server holds the lock, and the raw
  // error does not say what to do about it.
  const message = error instanceof Error ? error.message : String(error);
  if (/lock|concurren/i.test(message)) {
    console.error("The graph is open in another process — most likely the server.");
    console.error("Back up a running deployment through its endpoint instead:");
    console.error("  curl -X POST -H 'Authorization: Bearer <token>' <host>/admin/backup");
    console.error("Or stop the server and run this again.");
    process.exit(1);
  }
  throw error;
}

try {
  const result = await backupGraph(graph, destination);
  console.log(`backed up to ${result.path}`);
  console.log(`  engine ${lbug.VERSION}, storage version ${lbug.STORAGE_VERSION}`);
  console.log(`  ${result.files.length} files: ${result.files.join(", ")}`);
} finally {
  await graph.close();
}
