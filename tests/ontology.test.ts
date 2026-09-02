import { describe, expect, it } from "vitest";
import { toDDL, validateNode, validateRelation, wouldCreateCycle } from "../src/ontology/compile";
import { parseOntology } from "../src/ontology/schema";
import { loadOntology, openGraph } from "../src/graph/db";

const base = loadOntology("ontology/base.yaml");

describe("parsing", () => {
  it("reads the base ontology", () => {
    expect(base.nodes.Concept.key).toBe("id");
    expect(base.enums.knowledge_type).toContain("procedural");
    expect(base.relations.PREREQUISITE_OF).toMatchObject({ from: "Concept", to: "Concept" });
  });

  it("rejects a relation pointing at a node type that does not exist", () => {
    const yaml = `
version: 1
nodes:
  A: { key: id, properties: { id: string } }
relations:
  R: { from: A, to: Nowhere }
`;
    expect(() => parseOntology(yaml)).toThrow(/unknown node type 'Nowhere'/);
  });

  it("rejects a key that is not a declared property", () => {
    const yaml = `
version: 1
nodes:
  A: { key: missing, properties: { id: string } }
relations: {}
`;
    expect(() => parseOntology(yaml)).toThrow(/key 'missing'/);
  });

  it("rejects a property referencing an undeclared enum", () => {
    const yaml = `
version: 1
nodes:
  A: { key: id, properties: { id: string, k: "enum(nope)" } }
relations: {}
`;
    expect(() => parseOntology(yaml)).toThrow(/undeclared enum 'nope'/);
  });
});

describe("DDL", () => {
  it("emits node tables before relation tables", () => {
    const ddl = toDDL(base);
    const firstRel = ddl.findIndex((s) => s.includes("REL TABLE"));
    const lastNode = ddl.map((s) => s.includes("NODE TABLE")).lastIndexOf(true);
    expect(lastNode).toBeLessThan(firstRel);
  });

  it("stores enums as STRING, since the engine has no ENUM type", () => {
    const concept = toDDL(base).find((s) => s.includes("NODE TABLE IF NOT EXISTS Concept"))!;
    expect(concept).toContain("knowledge_type STRING");
    expect(concept).toContain("embedding FLOAT[384]");
    expect(concept).toContain("PRIMARY KEY (id)");
  });
});

describe("validation — the checks the engine cannot express", () => {
  const valid = {
    id: "c1",
    pref_label: "Log compaction",
    definition: "Retaining the latest value per key rather than a time window.",
    knowledge_type: "conceptual",
    created_at: "2026-01-01",
  };

  it("accepts a well-formed concept", () => {
    expect(validateNode(base, "Concept", valid)).toEqual([]);
  });

  it("rejects an unknown node type", () => {
    expect(validateNode(base, "Sandwich", {})).toMatchObject([{ message: /unknown node type/ }]);
  });

  it("rejects a value outside an enum", () => {
    const violations = validateNode(base, "Concept", { ...valid, knowledge_type: "vibes" });
    expect(violations).toMatchObject([{ path: "Concept.knowledge_type", message: /not in knowledge_type/ }]);
  });

  it("rejects a missing required property", () => {
    const { definition, ...missing } = valid;
    expect(validateNode(base, "Concept", missing)).toMatchObject([
      { path: "Concept.definition", message: /required/ },
    ]);
  });

  it("rejects an undeclared property", () => {
    const violations = validateNode(base, "Concept", { ...valid, vibe: "good" });
    expect(violations).toMatchObject([{ message: /not a property of Concept/ }]);
  });

  it("rejects a vector of the wrong dimension", () => {
    const violations = validateNode(base, "Concept", { ...valid, embedding: [0.1, 0.2] });
    expect(violations).toMatchObject([{ message: /384-dimension vector/ }]);
  });

  it("requires multiple-choice items to carry competitive distractors", () => {
    const item = {
      id: "i1",
      format: "multiple_choice",
      bloom_level: "understand",
      stem: "Which guarantee does a compacted topic provide?",
      answer: "The latest value per key is retained",
      rationale: "Compaction is per-key, not per-window.",
      distractors: ["Only one distractor"],
      created_at: "2026-01-01",
    };
    expect(validateNode(base, "Item", item)).toMatchObject([
      { path: "Item.distractors", message: /at least 2/ },
    ]);
    expect(validateNode(base, "Item", { ...item, distractors: ["a", "b"] })).toEqual([]);
  });

  it("does not apply the distractor rule to cloze items", () => {
    const cloze = {
      id: "i2",
      format: "cloze",
      bloom_level: "remember",
      stem: "A compacted topic retains the latest value per {{blank}}.",
      answer: "key",
      rationale: "Compaction is keyed.",
      distractors: [],
      created_at: "2026-01-01",
    };
    expect(validateNode(base, "Item", cloze)).toEqual([]);
  });

  it("rejects a relation between the wrong endpoints", () => {
    expect(validateRelation(base, "IN_SCHEME", "Concept", "Concept")).toMatchObject([
      { message: /goes Concept -> Scheme/ },
    ]);
    expect(validateRelation(base, "IN_SCHEME", "Concept", "Scheme")).toEqual([]);
  });
});

describe("acyclicity", () => {
  // a -> b -> c
  const edges = new Map([
    ["a", ["b"]],
    ["b", ["c"]],
  ]);

  it("allows an edge that extends the chain", () => {
    expect(wouldCreateCycle(edges, "c", "d")).toBe(false);
  });

  it("catches an edge that closes a cycle", () => {
    expect(wouldCreateCycle(edges, "c", "a")).toBe(true);
  });

  it("catches a self-loop", () => {
    expect(wouldCreateCycle(edges, "a", "a")).toBe(true);
  });
});

describe("the engine's half of the contract", () => {
  it("applies the schema and enforces structure itself", async () => {
    const graph = await openGraph(":memory:", base);
    try {
      await graph.query(
        `CREATE (s:Scheme {id: 'kafka', title: 'Kafka internals', description: '', created_at: current_timestamp()})`,
      );
      const rows = await graph.query(`MATCH (s:Scheme) RETURN s.title AS title`);
      expect(rows).toEqual([{ title: "Kafka internals" }]);

      // Structure and types are the engine's job, and it does reject them.
      await expect(graph.query(`CREATE (x:Sandwich {id: 'x'})`)).rejects.toThrow(/does not exist/i);
      await expect(graph.query(`CREATE (s:Scheme {id: 's2', nonexistent: 1})`)).rejects.toThrow(
        /Cannot find property/i,
      );
      await expect(
        graph.query(`MATCH (a:Scheme), (b:Scheme) CREATE (a)-[:IN_SCHEME]->(b)`),
      ).rejects.toThrow(/violates schema/i);
      await expect(
        graph.query(
          `CREATE (s:Scheme {id: 'kafka', title: 'dup', description: '', created_at: current_timestamp()})`,
        ),
      ).rejects.toThrow(/duplicated primary key/i);
    } finally {
      await graph.close();
    }
  });
});
