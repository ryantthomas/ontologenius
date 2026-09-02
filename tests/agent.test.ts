import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadOntology, openGraph, type Graph } from "../src/graph/db";
import { runnableTools, type ToolCallRecord } from "../src/agent/loop";

/** Runnable tools are a union; the custom ones carry the wire-shaped schema. */
const schemaOf = (tool: unknown) =>
  (tool as { input_schema: { type?: string; properties?: Record<string, unknown> } }).input_schema;

/**
 * The live path needs a real API key, so what is checked here is everything up
 * to the network: that the shared contract survives conversion into the shape
 * the Messages API expects, and that the tools still write through the same
 * validated path the MCP connector uses.
 */
describe("the BYOK driver's tools", () => {
  let graph: Graph;
  let record: ToolCallRecord[];

  beforeEach(async () => {
    graph = await openGraph(":memory:", loadOntology("ontology/base.yaml"));
    record = [];
  });

  afterEach(async () => {
    await graph.close();
  });

  it("exposes the same five tools as the connector", () => {
    expect(runnableTools(graph, record).map((t) => t.name).sort()).toEqual([
      "add_concepts",
      "add_items",
      "open_scheme",
      "progress",
      "relate",
    ]);
  });

  it("carries the ontology's enums through JSON Schema conversion", () => {
    const concepts = runnableTools(graph, record).find((t) => t.name === "add_concepts")!;
    const schema = JSON.stringify(schemaOf(concepts));

    // Declared only in ontology/base.yaml — if conversion dropped enums, the
    // model would be free to invent values the validator then rejects.
    expect(schema).toContain("metacognitive");
    expect(schema).toContain("procedural");
    expect(schema).not.toContain("$schema");
  });

  it("produces object schemas the API will accept", () => {
    for (const tool of runnableTools(graph, record)) {
      const schema = schemaOf(tool);
      expect(schema.type).toBe("object");
      expect(Object.keys(schema.properties ?? {}).length).toBeGreaterThan(0);
    }
  });

  it("writes through the validated path and records what it did", async () => {
    const tools = Object.fromEntries(runnableTools(graph, record).map((t) => [t.name, t]));

    await tools.open_scheme.run({ title: "Test Topic" } as never);
    const added = await tools.add_concepts.run({
      scheme: "test-topic",
      concepts: [
        {
          pref_label: "A",
          definition: "A thing.",
          knowledge_type: "conceptual",
          source: { kind: "documentation", citation: "docs" },
        },
      ],
    } as never);

    expect(JSON.parse(added as string).accepted).toEqual(["test-topic:a"]);
    expect(record.map((r) => r.name)).toEqual(["open_scheme", "add_concepts"]);
  });

  it("rejects an ontology violation rather than writing it", async () => {
    const tools = Object.fromEntries(runnableTools(graph, record).map((t) => [t.name, t]));
    await tools.open_scheme.run({ title: "T" } as never);

    const result = JSON.parse(
      (await tools.add_concepts.run({
        scheme: "t",
        concepts: [
          {
            pref_label: "A",
            definition: "A thing.",
            knowledge_type: "vibes",
            source: { kind: "documentation", citation: "docs" },
          },
        ],
      } as never)) as string,
    );

    expect(result.accepted).toEqual([]);
    expect(result.rejected[0].violations[0]).toMatch(/knowledge_type/);
  });
});
