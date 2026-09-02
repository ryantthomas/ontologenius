/**
 * Builds a small demo graph without an LLM, so the study loop and the UI can be
 * developed and tested independently of the MCP connector.
 *
 *   npm run seed              -> writes ./data/demo
 *   npm run seed -- :memory:  -> throwaway
 */
import { loadOntology, openGraph } from "../src/graph/db";
import { addConcepts, addItems, conceptId, openScheme, relate } from "../src/graph/write";

const SCHEME = "kafka";

const docs = (citation: string, url: string) => ({ kind: "documentation", citation, url });

const CONCEPTS = [
  {
    pref_label: "Topic",
    definition: "A named, append-only log that producers write to and consumers read from.",
    knowledge_type: "conceptual",
    source: docs("Kafka documentation — Topics", "https://kafka.apache.org/documentation/#intro_concepts_and_terms"),
  },
  {
    pref_label: "Partition",
    definition:
      "The unit of parallelism within a topic: an ordered, immutable sequence of records that lives on one leader broker.",
    knowledge_type: "conceptual",
    source: docs("Kafka documentation — Partitions", "https://kafka.apache.org/documentation/#intro_topics"),
  },
  {
    pref_label: "Offset",
    definition: "A monotonically increasing identifier assigned to each record within a partition.",
    knowledge_type: "factual",
    source: docs("Kafka documentation — Offsets", "https://kafka.apache.org/documentation/#intro_topics"),
  },
  {
    pref_label: "Replication factor",
    definition: "How many brokers hold a copy of each partition, one of which is the leader.",
    knowledge_type: "conceptual",
    source: docs("Kafka documentation — Replication", "https://kafka.apache.org/documentation/#replication"),
  },
  {
    pref_label: "In-sync replica set",
    definition:
      "The subset of replicas currently caught up to the leader; acknowledgement semantics are defined in terms of it.",
    knowledge_type: "conceptual",
    difficulty_hint: 0.7,
    source: docs("Kafka documentation — ISR", "https://kafka.apache.org/documentation/#design_replicatedlog"),
  },
  {
    pref_label: "Log compaction",
    definition:
      "A retention policy that keeps the most recent value for each key rather than discarding records by age.",
    knowledge_type: "conceptual",
    difficulty_hint: 0.6,
    source: docs("Kafka documentation — Log compaction", "https://kafka.apache.org/documentation/#compaction"),
  },
];

const PREREQUISITES: [string, string][] = [
  ["Topic", "Partition"],
  ["Partition", "Offset"],
  ["Partition", "Replication factor"],
  ["Replication factor", "In-sync replica set"],
  ["Topic", "Log compaction"],
];

// Every concept needs at least one item. Mastery only moves on answered
// questions, so an unassessed concept can never be mastered — and because
// prerequisites gate what unlocks, it would block everything downstream.
const ITEMS = [
  {
    concept: "Topic",
    format: "cloze",
    bloom_level: "remember",
    stem: "A topic is an append-only {{blank}} that producers write to.",
    answer: "log",
    rationale: "Kafka's core abstraction is the log, not a queue: reads do not consume.",
  },
  {
    concept: "Partition",
    format: "multiple_choice",
    bloom_level: "understand",
    stem: "What does partitioning a topic primarily buy you?",
    answer: "Parallelism, since partitions are consumed independently",
    distractors: [
      "Durability, since each partition is a separate backup",
      "Ordering across the whole topic",
      "Compression, since partitions are stored together",
    ],
    rationale:
      "Partitions are the unit of parallelism. Ordering is guaranteed within a partition, not across a topic.",
  },
  {
    concept: "Replication factor",
    format: "cloze",
    bloom_level: "remember",
    stem: "With a replication factor of 3, a partition can lose {{blank}} brokers without losing data.",
    answer: "2",
    rationale: "Three copies means two can fail while one still holds the data.",
  },
  {
    concept: "Offset",
    format: "cloze",
    bloom_level: "remember",
    stem: "An offset is unique within a single {{blank}}, not across the whole topic.",
    answer: "partition",
    rationale: "Ordering guarantees in Kafka are per-partition, so offsets are scoped to a partition.",
  },
  {
    concept: "Log compaction",
    format: "multiple_choice",
    bloom_level: "understand",
    stem: "What does a compacted topic guarantee about retained records?",
    answer: "The most recent value for each key is retained",
    distractors: [
      "Every record from the last seven days is retained",
      "Only records smaller than the segment size are retained",
      "Records are retained until every consumer group has committed them",
    ],
    rationale:
      "Compaction is keyed, not time-based: it discards superseded values per key rather than expiring by age.",
  },
  {
    concept: "In-sync replica set",
    format: "multiple_choice",
    bloom_level: "analyze",
    stem: "With acks=all, when is a produce request acknowledged?",
    answer: "Once every replica in the in-sync replica set has the record",
    distractors: [
      "Once every replica of the partition has the record",
      "Once the leader has written the record to its own log",
      "Once a majority of brokers in the cluster have the record",
    ],
    rationale:
      "acks=all is defined against the ISR, not the full replica set — which is why min.insync.replicas matters.",
  },
];

const report = (label: string, result: { accepted: string[]; rejected: unknown[] }) => {
  console.log(`${label}: ${result.accepted.length} accepted, ${result.rejected.length} rejected`);
  if (result.rejected.length) console.dir(result.rejected, { depth: 4 });
};

const path = process.argv[2] ?? "./data/demo";
const graph = await openGraph(path, loadOntology("ontology/base.yaml"));

try {
  report("scheme", await openScheme(graph, { id: SCHEME, title: "Kafka internals", description: "" }));
  report("concepts", await addConcepts(graph, SCHEME, CONCEPTS));
  report(
    "prerequisites",
    await relate(
      graph,
      PREREQUISITES.map(([from, to]) => ({
        relation: "PREREQUISITE_OF",
        from: conceptId(SCHEME, from),
        to: conceptId(SCHEME, to),
      })),
    ),
  );
  report(
    "items",
    await addItems(
      graph,
      ITEMS.map((item) => ({ ...item, concept: conceptId(SCHEME, item.concept) })),
    ),
  );

  const counts = await graph.query(
    `MATCH (c:Concept)-[:IN_SCHEME]->(s:Scheme {id: $id}) RETURN count(c) AS concepts`,
    { id: SCHEME },
  );
  console.log(`\ngraph at ${path}:`, counts[0]);
} finally {
  await graph.close();
}
