/**
 * Rebuild a graph from a backup into a fresh database.
 *
 *   npm run restore -- ./backups/<timestamp> ./data/restored
 *
 * The destination must not already exist: this rebuilds, it does not merge.
 */
import { restoreGraph } from "../src/graph/backup";
import { loadOntology } from "../src/graph/db";

const [source, destination] = process.argv.slice(2);

if (!source || !destination) {
  console.error("usage: npm run restore -- <backup-dir> <destination-graph>");
  process.exit(1);
}

const graph = await restoreGraph(
  source,
  destination,
  loadOntology(process.env.ONTOLOGY_PATH ?? "ontology/base.yaml"),
);

try {
  const [counts] = await graph.query(`MATCH (c:Concept) RETURN count(c) AS concepts`);
  console.log(`restored ${destination}: ${counts.concepts} concepts`);
} finally {
  await graph.close();
}
