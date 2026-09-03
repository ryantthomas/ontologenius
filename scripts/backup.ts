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

const graph = await openGraph(
  process.env.GRAPH_PATH ?? "./data/demo",
  loadOntology(process.env.ONTOLOGY_PATH ?? "ontology/base.yaml"),
);

try {
  const result = await backupGraph(graph, destination);
  console.log(`backed up to ${result.path}`);
  console.log(`  engine ${lbug.VERSION}, storage version ${lbug.STORAGE_VERSION}`);
  console.log(`  ${result.files.length} files: ${result.files.join(", ")}`);
} finally {
  await graph.close();
}
