import { beforeEach, describe, expect, it } from "vitest";
import { loadOntology, openGraph, type Graph } from "../src/graph/db.js";
import { addConcepts, addItems, conceptId, openScheme, relate } from "../src/graph/write.js";
import { NEW_CONCEPTS_PER_SESSION, progress, recordAnswer, studyQueue } from "../src/graph/study.js";
import { MASTERY_THRESHOLD } from "../src/learning/bkt.js";

const SCHEME = "t";
const LEARNER = "learner-1";
const source = { kind: "documentation", citation: "test", url: "https://example.invalid" };

const concept = (label: string) => ({
  pref_label: label,
  definition: `Definition of ${label}.`,
  knowledge_type: "conceptual",
  source,
});

const item = (label: string, n: number) => ({
  concept: conceptId(SCHEME, label),
  format: "cloze",
  bloom_level: "remember",
  stem: `Question ${n} about ${label}: {{blank}}.`,
  answer: "answer",
  rationale: `Because of ${label}.`,
});

/** A scheme of six concepts, A -> B (prerequisite), each with two items. */
async function buildGraph(): Promise<Graph> {
  const graph = await openGraph(":memory:", loadOntology("ontology/base.yaml"));
  const labels = ["A", "B", "C", "D", "E", "F"];

  await openScheme(graph, { id: SCHEME, title: "Test", description: "" });
  await addConcepts(graph, SCHEME, labels.map(concept));
  await relate(graph, [
    { relation: "PREREQUISITE_OF", from: conceptId(SCHEME, "A"), to: conceptId(SCHEME, "B") },
  ]);
  await addItems(
    graph,
    labels.flatMap((label) => [item(label, 1), item(label, 2)]),
  );

  return graph;
}

describe("study session composition", () => {
  let graph: Graph;
  beforeEach(async () => {
    graph = await buildGraph();
  });

  it("withholds a concept whose prerequisite is not yet mastered", async () => {
    const queue = await studyQueue(graph, LEARNER, SCHEME);
    expect(queue.map((i) => i.conceptLabel)).not.toContain("B");
    expect(queue.map((i) => i.conceptLabel)).toContain("A");
  });

  it("caps how many new concepts appear at once", async () => {
    const queue = await studyQueue(graph, LEARNER, SCHEME);
    expect(new Set(queue.map((i) => i.conceptId)).size).toBeLessThanOrEqual(NEW_CONCEPTS_PER_SESSION);
  });

  it("interleaves consecutive items across different concepts", async () => {
    const queue = await studyQueue(graph, LEARNER, SCHEME);
    const backToBack = queue.filter((q, i) => i > 0 && queue[i - 1].conceptId === q.conceptId);
    expect(backToBack).toEqual([]);
  });

  it("unlocks the dependent concept once its prerequisite is mastered", async () => {
    const aItems = (await studyQueue(graph, LEARNER, SCHEME)).filter((i) => i.conceptLabel === "A");

    // Answer correctly until A crosses the mastery threshold.
    let outcome = await recordAnswer(graph, LEARNER, aItems[0].itemId, true);
    for (let i = 0; i < 10 && !outcome.mastered; i++) {
      outcome = await recordAnswer(graph, LEARNER, aItems[0].itemId, true);
    }
    expect(outcome.mastered).toBe(true);

    const after = await studyQueue(graph, LEARNER, SCHEME);
    expect(after.map((i) => i.conceptLabel)).toContain("B");
  });
});

describe("recording an answer", () => {
  let graph: Graph;
  beforeEach(async () => {
    graph = await buildGraph();
  });

  it("persists mastery, schedule and the event log across reads", async () => {
    const [first] = await studyQueue(graph, LEARNER, SCHEME);
    const outcome = await recordAnswer(graph, LEARNER, first.itemId, true, 1500);

    expect(outcome.pKnown).toBeGreaterThan(0);
    expect(outcome.due.getTime()).toBeGreaterThan(Date.now());
    expect(outcome.rationale).toContain("Because of");

    const [mastery] = await graph.query(
      `MATCH (l:Learner {id: $l})-[m:MASTERY]->(c:Concept {id: $c})
       RETURN m.p_known AS p, m.attempts AS attempts`,
      { l: LEARNER, c: first.conceptId },
    );
    expect(Number(mastery.attempts)).toBe(1);
    expect(Number(mastery.p)).toBeCloseTo(outcome.pKnown, 6);

    const [scheduled] = await graph.query(
      `MATCH (l:Learner {id: $l})-[s:SCHEDULED]->(i:Item {id: $i}) RETURN s.reps AS reps, s.due AS due`,
      { l: LEARNER, i: first.itemId },
    );
    expect(Number(scheduled.reps)).toBe(1);
    expect(scheduled.due).toBeTruthy();

    const [answered] = await graph.query(
      `MATCH (l:Learner {id: $l})-[a:ANSWERED]->(i:Item {id: $i})
       RETURN count(a) AS n, a.latency_ms AS latency`,
      { l: LEARNER, i: first.itemId },
    );
    expect(Number(answered.n)).toBe(1);
    expect(Number(answered.latency)).toBe(1500);
  });

  it("appends to the event log rather than overwriting it", async () => {
    const [first] = await studyQueue(graph, LEARNER, SCHEME);
    await recordAnswer(graph, LEARNER, first.itemId, true);
    await recordAnswer(graph, LEARNER, first.itemId, false);

    const [row] = await graph.query(
      `MATCH (l:Learner {id: $l})-[a:ANSWERED]->(i:Item {id: $i}) RETURN count(a) AS n`,
      { l: LEARNER, i: first.itemId },
    );
    expect(Number(row.n)).toBe(2);
  });

  it("lowers the posterior on a wrong answer", async () => {
    const [first] = await studyQueue(graph, LEARNER, SCHEME);
    const right = await recordAnswer(graph, LEARNER, first.itemId, true);
    const wrong = await recordAnswer(graph, LEARNER, first.itemId, false);
    expect(wrong.pKnown).toBeLessThan(right.pKnown);
  });

  it("rejects an unknown item", async () => {
    await expect(recordAnswer(graph, LEARNER, "nope", true)).rejects.toThrow(/no item/);
  });
});

describe("progress", () => {
  it("reports mastery rather than coverage, and names the weakest concepts", async () => {
    const graph = await buildGraph();
    const before = await progress(graph, LEARNER, SCHEME);
    expect(before).toMatchObject({ concepts: 6, mastered: 0, attempted: 0 });

    const [first] = await studyQueue(graph, LEARNER, SCHEME);
    await recordAnswer(graph, LEARNER, first.itemId, false);

    const after = await progress(graph, LEARNER, SCHEME);
    expect(after.attempted).toBe(1);
    expect(after.mastered).toBe(0);
    expect(after.weakest[0].pKnown).toBeLessThan(MASTERY_THRESHOLD);
  });
});
