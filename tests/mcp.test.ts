import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadOntology, openGraph, type Graph } from "../src/graph/db";
import { createServer } from "../src/mcp/server";

const source = { kind: "documentation", citation: "Test docs", url: "https://example.invalid" };

/** A connected client speaking to the real server over an in-memory transport. */
async function connect(): Promise<{ client: Client; graph: Graph }> {
  const graph = await openGraph(":memory:", loadOntology("ontology/base.yaml"));
  const server = await createServer(graph);
  const client = new Client({ name: "test", version: "0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, graph };
}

/** The text of a tool result, whether it succeeded or came back as an error. */
async function callText(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];
  return { isError: result.isError === true, text: content[0].text };
}

/** Tool results come back as JSON in a text block. */
async function call(client: Client, name: string, args: Record<string, unknown>) {
  const { isError, text } = await callText(client, name, args);
  if (isError) throw new Error(`${name} returned an error: ${text}`);
  return { data: JSON.parse(text) };
}

describe("the tool surface Claude sees", () => {
  let client: Client;
  let graph: Graph;
  beforeEach(async () => {
    ({ client, graph } = await connect());
  });
  afterEach(async () => {
    await client.close();
    await graph.close();
  });

  it("exposes the five workflow tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "add_concepts",
      "add_items",
      "open_scheme",
      "progress",
      "relate",
    ]);
  });

  it("advertises the ontology's own enums, so the schema cannot drift from the validator", async () => {
    const { tools } = await client.listTools();
    const concepts = tools.find((t) => t.name === "add_concepts")!;
    const schema = JSON.stringify(concepts.inputSchema);

    // These values exist in ontology/base.yaml and nowhere in the tool source.
    expect(schema).toContain("metacognitive");
    expect(schema).toContain("procedural");

    const relate = tools.find((t) => t.name === "relate")!;
    expect(relate.description).toContain("PREREQUISITE_OF");
    // Learner state is written from real responses, never asserted by a model.
    expect(JSON.stringify(relate.inputSchema)).not.toContain("MASTERY");
  });
});

describe("building a graph through the tools", () => {
  let client: Client;
  let graph: Graph;
  beforeEach(async () => {
    ({ client, graph } = await connect());
  });
  afterEach(async () => {
    await client.close();
    await graph.close();
  });

  it("walks open_scheme -> add_concepts -> relate -> add_items", async () => {
    const scheme = await call(client, "open_scheme", { title: "Kafka Internals" });
    expect(scheme.data.scheme).toBe("kafka-internals");

    const concepts = await call(client, "add_concepts", {
      scheme: "kafka-internals",
      concepts: [
        { pref_label: "Topic", definition: "An append-only log.", knowledge_type: "conceptual", source },
        { pref_label: "Partition", definition: "The unit of parallelism.", knowledge_type: "conceptual", source },
      ],
    });
    expect(concepts.data.accepted_count).toBe(2);
    expect(concepts.data.accepted).toEqual(["kafka-internals:topic", "kafka-internals:partition"]);

    const edges = await call(client, "relate", {
      edges: [
        {
          relation: "PREREQUISITE_OF",
          from: "kafka-internals:topic",
          to: "kafka-internals:partition",
        },
      ],
    });
    expect(edges.data.rejected).toEqual([]);

    const items = await call(client, "add_items", {
      items: [
        {
          concept: "kafka-internals:topic",
          format: "cloze",
          bloom_level: "remember",
          stem: "A topic is an append-only {{blank}}.",
          answer: "log",
          rationale: "The log is Kafka's core abstraction.",
        },
      ],
    });
    expect(items.data.accepted_count).toBe(1);
  });
});

describe("rejections a model can act on", () => {
  let client: Client;
  let graph: Graph;
  beforeEach(async () => {
    ({ client, graph } = await connect());
    await call(client, "open_scheme", { title: "T" });
  });
  afterEach(async () => {
    await client.close();
    await graph.close();
  });

  // Required fields and enums are enforced by the tool schema, so these never
  // reach the handler and come back as isError results rather than in the
  // rejection list. Different channel, same requirement: the message has to
  // name what was wrong, or the model cannot fix it.
  it("names the missing source, through the schema rather than the handler", async () => {
    const result = await callText(client, "add_concepts", {
      scheme: "t",
      concepts: [{ pref_label: "A", definition: "A thing.", knowledge_type: "conceptual" }],
    });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/source/i);
  });

  it("names the offending enum value when one is outside the ontology", async () => {
    const result = await callText(client, "add_concepts", {
      scheme: "t",
      concepts: [{ pref_label: "A", definition: "A thing.", knowledge_type: "vibes", source }],
    });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/knowledge_type/i);
  });

  it("reports a prerequisite cycle with the reason, not a stack trace", async () => {
    await call(client, "add_concepts", {
      scheme: "t",
      concepts: [
        { pref_label: "A", definition: "First.", knowledge_type: "conceptual", source },
        { pref_label: "B", definition: "Second.", knowledge_type: "conceptual", source },
      ],
    });
    await call(client, "relate", {
      edges: [{ relation: "PREREQUISITE_OF", from: "t:a", to: "t:b" }],
    });

    const cycle = await call(client, "relate", {
      edges: [{ relation: "PREREQUISITE_OF", from: "t:b", to: "t:a" }],
    });

    expect(cycle.data.accepted).toEqual([]);
    expect(cycle.data.rejected[0].violations[0]).toMatch(/cycle/);
  });

  it("tells a model which concepts still have no questions", async () => {
    await call(client, "add_concepts", {
      scheme: "t",
      concepts: [
        { pref_label: "A", definition: "First.", knowledge_type: "conceptual", source },
        { pref_label: "B", definition: "Second.", knowledge_type: "conceptual", source },
      ],
    });
    await call(client, "add_items", {
      items: [
        {
          concept: "t:a",
          format: "cloze",
          bloom_level: "remember",
          stem: "A is {{blank}}.",
          answer: "first",
          rationale: "Because.",
        },
      ],
    });

    const summary = await call(client, "progress", { scheme: "t" });
    expect(summary.data.unassessed).toMatchObject([{ label: "B" }]);
    expect(summary.data.notes.join(" ")).toMatch(/cannot be mastered/);
  });

  it("rejects a multiple-choice item with too few distractors, and accepts the fix", async () => {
    await call(client, "add_concepts", {
      scheme: "t",
      concepts: [{ pref_label: "A", definition: "First.", knowledge_type: "conceptual", source }],
    });

    const thin = {
      concept: "t:a",
      format: "multiple_choice",
      bloom_level: "understand",
      stem: "Which?",
      answer: "This one",
      distractors: ["Only one"],
      rationale: "Because.",
    };

    const rejected = await call(client, "add_items", { items: [thin] });
    expect(rejected.data.accepted).toEqual([]);
    expect(rejected.data.rejected[0].violations[0]).toMatch(/at least 2/);

    // The rejection carries enough to correct the call.
    const fixed = await call(client, "add_items", {
      items: [{ ...thin, distractors: ["Only one", "Another"] }],
    });
    expect(fixed.data.accepted_count).toBe(1);
  });
});
