import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadOntology, openGraph, type Graph } from "../src/graph/db";
import { addConcepts, addItems, conceptId, openScheme, relate } from "../src/graph/write";
import {
  ATTEMPTS_BEFORE_DECOMPOSING,
  NEW_CONCEPTS_PER_SESSION,
  availableConcepts,
  progress,
  recordAnswer,
  studyQueue,
} from "../src/graph/study";
import { MASTERY_THRESHOLD, UNLOCK_THRESHOLD } from "../src/learning/bkt";

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

/**
 * Graphs opened by a test, closed when it ends. Each holds a buffer pool, so
 * leaking them exhausts the address space — non-deterministically, which is
 * worse than failing outright.
 */
const opened: Graph[] = [];

afterEach(async () => {
  while (opened.length > 0) await opened.pop()!.close();
});

async function open(): Promise<Graph> {
  const graph = await openGraph(":memory:", loadOntology("ontology/base.yaml"));
  opened.push(graph);
  return graph;
}

/** A scheme of six concepts, A -> B (prerequisite), each with two items. */
async function buildGraph(): Promise<Graph> {
  const graph = await open();
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

  it("unlocks the dependent concept once its prerequisite passes the unlock bar", async () => {
    const aItems = (await studyQueue(graph, LEARNER, SCHEME)).filter((i) => i.conceptLabel === "A");

    let outcome = await recordAnswer(graph, LEARNER, aItems[0].itemId, true);
    for (let i = 0; i < 10 && outcome.pKnown < UNLOCK_THRESHOLD; i++) {
      outcome = await recordAnswer(graph, LEARNER, aItems[0].itemId, true);
    }
    expect(outcome.pKnown).toBeGreaterThanOrEqual(UNLOCK_THRESHOLD);

    const after = await studyQueue(graph, LEARNER, SCHEME);
    expect(after.map((i) => i.conceptLabel)).toContain("B");
  });

  it("unlocks dependents before the prerequisite is fully mastered", async () => {
    // The two thresholds are distinct on purpose: knowing enough to proceed is
    // a weaker claim than having mastered the material.
    expect(UNLOCK_THRESHOLD).toBeLessThan(MASTERY_THRESHOLD);

    const aItems = (await studyQueue(graph, LEARNER, SCHEME)).filter((i) => i.conceptLabel === "A");
    let outcome = await recordAnswer(graph, LEARNER, aItems[0].itemId, true);
    while (outcome.pKnown < UNLOCK_THRESHOLD) {
      outcome = await recordAnswer(graph, LEARNER, aItems[0].itemId, true);
    }

    expect(outcome.mastered).toBe(false);
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

describe("unassessed concepts", () => {
  it("reports concepts carrying no items, since they can never be mastered", async () => {
    const graph = await open();
    await openScheme(graph, { id: SCHEME, title: "Test", description: "" });
    await addConcepts(graph, SCHEME, [concept("A"), concept("B")]);
    await addItems(graph, [item("A", 1)]);

    const summary = await progress(graph, LEARNER, SCHEME);
    expect(summary.unassessed.map((c) => c.label)).toEqual(["B"]);
  });
});

describe("decomposition", () => {
  /** Answer one concept's item wrong repeatedly, to make the learner stuck on it. */
  async function failRepeatedly(graph: Graph, label: string, times: number) {
    const items = (await studyQueue(graph, LEARNER, SCHEME)).filter((i) => i.conceptLabel === label);
    for (let i = 0; i < times; i++) {
      await recordAnswer(graph, LEARNER, items[0].itemId, false);
    }
  }

  it("flags a concept the learner keeps failing, but not one merely unattempted", async () => {
    const graph = await buildGraph();
    await failRepeatedly(graph, "A", ATTEMPTS_BEFORE_DECOMPOSING);

    const summary = await progress(graph, LEARNER, SCHEME);
    expect(summary.needsDecomposition.map((c) => c.label)).toEqual(["A"]);
    expect(summary.needsDecomposition[0].attempts).toBeGreaterThanOrEqual(
      ATTEMPTS_BEFORE_DECOMPOSING,
    );
  });

  it("does not flag a concept that has already been broken down", async () => {
    const graph = await buildGraph();
    await failRepeatedly(graph, "A", ATTEMPTS_BEFORE_DECOMPOSING);

    await addConcepts(graph, SCHEME, [concept("A part")]);
    await relate(graph, [
      { relation: "PART_OF", from: conceptId(SCHEME, "A part"), to: conceptId(SCHEME, "A") },
    ]);

    const summary = await progress(graph, LEARNER, SCHEME);
    expect(summary.needsDecomposition).toEqual([]);
  });

  it("withholds a whole until its parts are known, then offers it again", async () => {
    // A two-concept graph, so the session's new-material cap cannot confound
    // what is being tested here: availability, not queue composition.
    const graph = await open();
    await openScheme(graph, { id: SCHEME, title: "Test", description: "" });
    await addConcepts(graph, SCHEME, [concept("Whole")]);
    await addItems(graph, [item("Whole", 1)]);

    const labels = async () =>
      (await availableConcepts(graph, LEARNER, SCHEME)).map((c) => String(c.label));

    // Unattached, the whole is available.
    expect(await labels()).toContain("Whole");

    await addConcepts(graph, SCHEME, [concept("Part")]);
    await addItems(graph, [item("Part", 1)]);
    await relate(graph, [
      { relation: "PART_OF", from: conceptId(SCHEME, "Part"), to: conceptId(SCHEME, "Whole") },
    ]);

    // Broken down, it is withheld until the part is known.
    expect(await labels()).toEqual(["Part"]);

    const [partItem] = (await studyQueue(graph, LEARNER, SCHEME)).filter(
      (i) => i.conceptLabel === "Part",
    );
    let outcome = await recordAnswer(graph, LEARNER, partItem.itemId, true);
    while (outcome.pKnown < UNLOCK_THRESHOLD) {
      outcome = await recordAnswer(graph, LEARNER, partItem.itemId, true);
    }

    // The whole is now the sum of what is known.
    expect(await labels()).toContain("Whole");
  });

  it("refuses a part-of cycle, since a thing cannot be part of itself", async () => {
    const graph = await buildGraph();
    await relate(graph, [
      { relation: "PART_OF", from: conceptId(SCHEME, "A"), to: conceptId(SCHEME, "B") },
    ]);

    const cycle = await relate(graph, [
      { relation: "PART_OF", from: conceptId(SCHEME, "B"), to: conceptId(SCHEME, "A") },
    ]);
    expect(cycle.accepted).toEqual([]);
    expect(cycle.rejected[0].violations[0].message).toMatch(/cycle/);
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
