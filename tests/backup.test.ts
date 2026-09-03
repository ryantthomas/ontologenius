import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupGraph, restoreGraph } from "../src/graph/backup";
import { loadOntology, openGraph, type Graph } from "../src/graph/db";
import { addConcepts, conceptId, openScheme } from "../src/graph/write";

const ontology = loadOntology("ontology/base.yaml");
const source = { kind: "documentation", citation: "test" };

describe("backups", () => {
  let workspace: string;
  let graph: Graph;

  beforeEach(async () => {
    workspace = mkdtempSync(join(tmpdir(), "ontologenius-"));
    graph = await openGraph(join(workspace, "graph"), ontology);
    await openScheme(graph, { id: "t", title: "Test", description: "" });
    await addConcepts(graph, "t", [
      {
        pref_label: "Topic",
        definition: "An append-only log.",
        knowledge_type: "conceptual",
        source,
      },
    ]);
  });

  afterEach(async () => {
    await graph.close();
    rmSync(workspace, { recursive: true, force: true });
  });

  it("writes the graph out as Parquet plus the schema that rebuilds it", async () => {
    const result = await backupGraph(graph, join(workspace, "backup"));

    // Parquet is what makes this an exit from the engine and not just a backup.
    expect(result.files).toContain("schema.cypher");
    expect(result.files.some((f) => f.endsWith(".parquet"))).toBe(true);
  });

  it("refuses to overwrite an existing backup unless told to", async () => {
    const destination = join(workspace, "backup");
    await backupGraph(graph, destination);

    await expect(backupGraph(graph, destination)).rejects.toThrow(/already exists/);
    await expect(backupGraph(graph, destination, { overwrite: true })).resolves.toBeTruthy();
  });

  it("round-trips the graph into a fresh database", async () => {
    const destination = join(workspace, "backup");
    await backupGraph(graph, destination);

    const restored = await restoreGraph(destination, join(workspace, "restored"), ontology);
    try {
      const [concept] = await restored.query(
        `MATCH (c:Concept {id: $id}) RETURN c.pref_label AS label, c.definition AS definition`,
        { id: conceptId("t", "Topic") },
      );
      expect(concept).toMatchObject({ label: "Topic", definition: "An append-only log." });

      // Relationships have to survive too, or it is not a graph backup.
      const [edge] = await restored.query(
        `MATCH (c:Concept)-[:IN_SCHEME]->(s:Scheme) RETURN count(c) AS n`,
      );
      expect(Number(edge.n)).toBe(1);

      const [sourced] = await restored.query(
        `MATCH (c:Concept)-[:CITES]->(src:Source) RETURN src.citation AS citation`,
      );
      expect(sourced.citation).toBe("test");
    } finally {
      await restored.close();
    }
  });

  it("reports a missing backup rather than failing obscurely", async () => {
    await expect(
      restoreGraph(join(workspace, "nope"), join(workspace, "restored"), ontology),
    ).rejects.toThrow(/no backup at/);
  });
});
