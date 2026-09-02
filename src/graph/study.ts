/**
 * The study loop: what to ask next, and what an answer does to the graph.
 *
 * Session composition follows the evidence rather than convenience. Due
 * reviews come first (distributed practice — Cepeda et al. 2006), new material
 * is capped per session (cognitive load — Sweller 1988), a concept is only
 * introduced once its prerequisites are mastered (knowledge space theory —
 * Doignon & Falmagne 1985), and items are interleaved across concepts rather
 * than blocked by concept (Rohrer & Taylor 2007).
 */
import { initialKnowledge, isMastered, unlocksDependents, updateKnowledge } from "../learning/bkt";
import { newSchedule, ratingFor, review, type ScheduleState } from "../learning/fsrs";
import type { Graph, Row } from "./db";

/** How many concepts a learner may meet for the first time in one session. */
export const NEW_CONCEPTS_PER_SESSION = 4;

export interface StudyItem {
  itemId: string;
  conceptId: string;
  conceptLabel: string;
  format: string;
  stem: string;
  answer: string;
  rationale: string;
  distractors: string[];
  isNew: boolean;
  due: Date | null;
}

const asDate = (value: unknown): Date | null => {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") return new Date(value);
  return null;
};

export async function ensureLearner(graph: Graph, learnerId: string): Promise<void> {
  const existing = await graph.query(`MATCH (l:Learner {id: $id}) RETURN l.id AS id`, { id: learnerId });
  if (existing.length === 0) {
    await graph.query(`CREATE (l:Learner {id: $id, created_at: current_timestamp()})`, { id: learnerId });
  }
}

/**
 * Concepts in the scheme whose prerequisites are all mastered — the fringe of
 * what this learner can productively study next.
 */
export async function availableConcepts(graph: Graph, learnerId: string, schemeId: string): Promise<Row[]> {
  const concepts = await graph.query(
    `MATCH (c:Concept)-[:IN_SCHEME]->(s:Scheme {id: $scheme})
     RETURN c.id AS id, c.pref_label AS label, c.difficulty_hint AS difficulty`,
    { scheme: schemeId },
  );

  const prerequisites = await graph.query(
    `MATCH (a:Concept)-[:PREREQUISITE_OF]->(b:Concept)-[:IN_SCHEME]->(s:Scheme {id: $scheme})
     RETURN a.id AS before, b.id AS after`,
    { scheme: schemeId },
  );

  const mastery = await graph.query(
    `MATCH (l:Learner {id: $learner})-[m:MASTERY]->(c:Concept)-[:IN_SCHEME]->(s:Scheme {id: $scheme})
     RETURN c.id AS id, m.p_known AS p_known`,
    { learner: learnerId, scheme: schemeId },
  );

  const known = new Map(mastery.map((row) => [String(row.id), Number(row.p_known)]));
  const blockers = new Map<string, string[]>();
  for (const row of prerequisites) {
    const after = String(row.after);
    blockers.set(after, [...(blockers.get(after) ?? []), String(row.before)]);
  }

  return concepts.filter((c) => {
    const required = blockers.get(String(c.id)) ?? [];
    return required.every((id) => unlocksDependents(known.get(id) ?? 0));
  });
}

/**
 * Build a study session: everything already due, then items from unseen
 * concepts up to the new-material cap, interleaved so consecutive questions
 * come from different concepts where possible.
 */
export async function studyQueue(
  graph: Graph,
  learnerId: string,
  schemeId: string,
  now: Date = new Date(),
): Promise<StudyItem[]> {
  await ensureLearner(graph, learnerId);

  const rows = await graph.query(
    `MATCH (i:Item)-[:ASSESSES]->(c:Concept)-[:IN_SCHEME]->(s:Scheme {id: $scheme})
     OPTIONAL MATCH (l:Learner {id: $learner})-[sched:SCHEDULED]->(i)
     RETURN i.id AS itemId, i.format AS format, i.stem AS stem, i.answer AS answer,
            i.rationale AS rationale, i.distractors AS distractors,
            c.id AS conceptId, c.pref_label AS conceptLabel, sched.due AS due`,
    { scheme: schemeId, learner: learnerId },
  );

  const available = new Set(
    (await availableConcepts(graph, learnerId, schemeId)).map((c) => String(c.id)),
  );

  const items: StudyItem[] = rows
    .filter((row) => available.has(String(row.conceptId)))
    .map((row) => ({
      itemId: String(row.itemId),
      conceptId: String(row.conceptId),
      conceptLabel: String(row.conceptLabel),
      format: String(row.format),
      stem: String(row.stem),
      answer: String(row.answer),
      rationale: String(row.rationale),
      distractors: (row.distractors as string[]) ?? [],
      due: asDate(row.due),
      isNew: row.due === null || row.due === undefined,
    }));

  const due = items
    .filter((i) => !i.isNew && i.due! <= now)
    .sort((a, b) => a.due!.getTime() - b.due!.getTime());

  // Cap new material by concept, not by item, so the limit means what
  // cognitive load theory intends: how many unfamiliar ideas are in play.
  const newConcepts = [...new Set(items.filter((i) => i.isNew).map((i) => i.conceptId))].slice(
    0,
    NEW_CONCEPTS_PER_SESSION,
  );
  const fresh = items.filter((i) => i.isNew && newConcepts.includes(i.conceptId));

  return [...due, ...interleave(fresh)];
}

/** Spread consecutive items across different concepts where possible. */
export function interleave(items: StudyItem[]): StudyItem[] {
  const byConcept = new Map<string, StudyItem[]>();
  for (const item of items) {
    byConcept.set(item.conceptId, [...(byConcept.get(item.conceptId) ?? []), item]);
  }

  const ordered: StudyItem[] = [];
  while (byConcept.size > 0) {
    for (const [concept, queue] of [...byConcept]) {
      ordered.push(queue.shift()!);
      if (queue.length === 0) byConcept.delete(concept);
    }
  }
  return ordered;
}

export interface AnswerOutcome {
  conceptId: string;
  pKnown: number;
  mastered: boolean;
  due: Date;
  correct: boolean;
  rationale: string;
}

/**
 * Record one answer: update the concept's mastery posterior, reschedule the
 * item, and append to the event log. The three writes are what every other
 * read in the app is derived from.
 */
export async function recordAnswer(
  graph: Graph,
  learnerId: string,
  itemId: string,
  correct: boolean,
  latencyMs = 0,
  now: Date = new Date(),
): Promise<AnswerOutcome> {
  await ensureLearner(graph, learnerId);

  const [item] = await graph.query(
    `MATCH (i:Item {id: $item})-[:ASSESSES]->(c:Concept)
     RETURN c.id AS conceptId, c.difficulty_hint AS difficulty, i.rationale AS rationale`,
    { item: itemId },
  );
  if (!item) throw new Error(`no item '${itemId}'`);

  const conceptId = String(item.conceptId);

  // --- mastery ------------------------------------------------------------
  const [existing] = await graph.query(
    `MATCH (l:Learner {id: $learner})-[m:MASTERY]->(c:Concept {id: $concept})
     RETURN m.p_known AS p_known, m.attempts AS attempts, m.correct AS correct`,
    { learner: learnerId, concept: conceptId },
  );

  const prior = existing
    ? Number(existing.p_known)
    : initialKnowledge(item.difficulty as number | null);
  const pKnown = updateKnowledge(prior, correct);
  const attempts = (existing ? Number(existing.attempts) : 0) + 1;
  const correctCount = (existing ? Number(existing.correct) : 0) + (correct ? 1 : 0);

  await graph.query(
    `MATCH (l:Learner {id: $learner}), (c:Concept {id: $concept})
     MERGE (l)-[m:MASTERY]->(c)
     SET m.p_known = $pKnown, m.attempts = $attempts, m.correct = $correct,
         m.last_seen = current_timestamp()`,
    { learner: learnerId, concept: conceptId, pKnown, attempts, correct: correctCount },
  );

  // --- scheduling ---------------------------------------------------------
  const [scheduled] = await graph.query(
    `MATCH (l:Learner {id: $learner})-[s:SCHEDULED]->(i:Item {id: $item})
     RETURN s.due AS due, s.stability AS stability, s.difficulty AS difficulty,
            s.reps AS reps, s.lapses AS lapses, s.state AS state,
            s.scheduled_days AS scheduled_days, s.learning_steps AS learning_steps`,
    { learner: learnerId, item: itemId },
  );

  const current: ScheduleState = scheduled
    ? {
        due: asDate(scheduled.due) ?? now,
        stability: Number(scheduled.stability),
        difficulty: Number(scheduled.difficulty),
        reps: Number(scheduled.reps),
        lapses: Number(scheduled.lapses),
        state: Number(scheduled.state),
        scheduled_days: Number(scheduled.scheduled_days),
        learning_steps: Number(scheduled.learning_steps),
      }
    : newSchedule(now);

  const next = review(current, ratingFor(correct), now);

  await graph.query(
    `MATCH (l:Learner {id: $learner}), (i:Item {id: $item})
     MERGE (l)-[s:SCHEDULED]->(i)
     SET s.due = $due, s.stability = $stability, s.difficulty = $difficulty,
         s.reps = $reps, s.lapses = $lapses, s.state = $state,
         s.scheduled_days = $scheduledDays, s.learning_steps = $learningSteps,
         s.last_review = $lastReview`,
    {
      learner: learnerId,
      item: itemId,
      due: next.due,
      stability: next.stability,
      difficulty: next.difficulty,
      reps: next.reps,
      lapses: next.lapses,
      state: next.state,
      scheduledDays: next.scheduled_days,
      learningSteps: next.learning_steps,
      lastReview: now,
    },
  );

  // --- event log ----------------------------------------------------------
  await graph.query(
    `MATCH (l:Learner {id: $learner}), (i:Item {id: $item})
     CREATE (l)-[:ANSWERED {at: current_timestamp(), correct: $correct,
                            rating: $rating, latency_ms: $latency, response: ''}]->(i)`,
    { learner: learnerId, item: itemId, correct, rating: ratingFor(correct), latency: latencyMs },
  );

  return {
    conceptId,
    pKnown,
    mastered: isMastered(pKnown),
    due: next.due,
    correct,
    rationale: String(item.rationale),
  };
}

/**
 * When the next review falls due, or null if nothing is scheduled. Used to
 * tell a learner who has cleared the queue when to come back, rather than
 * leaving them staring at an empty session.
 */
export async function nextDue(graph: Graph, learnerId: string, schemeId: string): Promise<Date | null> {
  const rows = await graph.query(
    `MATCH (l:Learner {id: $learner})-[s:SCHEDULED]->(i:Item)-[:ASSESSES]->(c:Concept)-[:IN_SCHEME]->(sc:Scheme {id: $scheme})
     RETURN min(s.due) AS due`,
    { learner: learnerId, scheme: schemeId },
  );
  return asDate(rows[0]?.due);
}

export interface Progress {
  concepts: number;
  mastered: number;
  attempted: number;
  dueNow: number;
  weakest: { conceptId: string; label: string; pKnown: number }[];
  /**
   * Concepts carrying no items. These are dead ends: mastery only moves on
   * answered questions, so an unassessed concept can never be mastered and
   * permanently blocks everything downstream of it. Reported so the agent
   * building the graph knows where to add questions.
   */
  unassessed: { conceptId: string; label: string }[];
}

/**
 * What the dashboard renders, and what the model reads back to aim the next
 * session. Completion is the share of concepts past the mastery threshold —
 * not coverage (Bloom 1984).
 */
export async function progress(graph: Graph, learnerId: string, schemeId: string): Promise<Progress> {
  const [totals] = await graph.query(
    `MATCH (c:Concept)-[:IN_SCHEME]->(s:Scheme {id: $scheme}) RETURN count(c) AS concepts`,
    { scheme: schemeId },
  );

  const mastery = await graph.query(
    `MATCH (l:Learner {id: $learner})-[m:MASTERY]->(c:Concept)-[:IN_SCHEME]->(s:Scheme {id: $scheme})
     RETURN c.id AS id, c.pref_label AS label, m.p_known AS p_known`,
    { learner: learnerId, scheme: schemeId },
  );

  const scored = mastery.map((row) => ({
    conceptId: String(row.id),
    label: String(row.label),
    pKnown: Number(row.p_known),
  }));

  const queue = await studyQueue(graph, learnerId, schemeId);

  const itemCounts = await graph.query(
    `MATCH (c:Concept)-[:IN_SCHEME]->(s:Scheme {id: $scheme})
     OPTIONAL MATCH (i:Item)-[:ASSESSES]->(c)
     RETURN c.id AS id, c.pref_label AS label, count(i) AS items`,
    { scheme: schemeId },
  );
  const unassessed = itemCounts.filter((row) => Number(row.items) === 0);

  return {
    concepts: Number(totals?.concepts ?? 0),
    mastered: scored.filter((c) => isMastered(c.pKnown)).length,
    attempted: scored.length,
    dueNow: queue.filter((i) => !i.isNew).length,
    weakest: [...scored].sort((a, b) => a.pKnown - b.pKnown).slice(0, 5),
    unassessed: unassessed.map((row) => ({ conceptId: String(row.id), label: String(row.label) })),
  };
}
