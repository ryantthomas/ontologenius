"use server";

import { toStudyCards, type StudyCard } from "../src/graph/cards";
import { nextDue, recordAnswer, studyQueue } from "../src/graph/study";
import { currentLearner, getGraph } from "../src/graph/session";

export interface GradedAnswer {
  correct: boolean;
  answer: string;
  rationale: string;
  pKnown: number;
  mastered: boolean;
  dueIn: string;
}

export interface QueueRefill {
  cards: StudyCard[];
  nextDueIn: string | null;
}

/** Ignore case, surrounding space and trailing punctuation when grading cloze. */
const normalise = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[.,;:!?'"]+$/g, "")
    .replace(/\s+/g, " ");

const relativeDue = (due: Date): string => {
  const minutes = Math.round((due.getTime() - Date.now()) / 60_000);
  if (minutes <= 1) return "in a moment";
  if (minutes < 60) return `in ${minutes} minutes`;

  const days = Math.round((due.getTime() - Date.now()) / 86_400_000);
  if (days < 1) return "later today";
  if (days === 1) return "tomorrow";
  if (days < 30) return `in ${days} days`;
  return `in ${Math.round(days / 30)} months`;
};

/**
 * Grade and record one answer.
 *
 * Grading happens here rather than in the browser so the correct answer is
 * never sent to the client before the learner has committed to a response —
 * retrieval practice only works if the answer has to be produced from memory.
 */
export async function submitAnswer(itemId: string, response: string, latencyMs: number): Promise<GradedAnswer> {
  const graph = await getGraph();

  const [item] = await graph.query(
    `MATCH (i:Item {id: $item}) RETURN i.answer AS answer, i.rationale AS rationale`,
    { item: itemId },
  );
  if (!item) throw new Error(`no item '${itemId}'`);

  const answer = String(item.answer);
  const correct = normalise(response) === normalise(answer);
  const outcome = await recordAnswer(graph, currentLearner(), itemId, correct, latencyMs);

  return {
    correct,
    answer,
    rationale: String(item.rationale),
    pKnown: outcome.pKnown,
    mastered: outcome.mastered,
    dueIn: relativeDue(outcome.due),
  };
}

/**
 * Refill the session once the current queue is exhausted.
 *
 * A failed item is rescheduled minutes away by FSRS's learning steps, and a
 * newly unlocked concept becomes available the moment its prerequisite passes
 * the unlock bar. Both mean the queue at page load goes stale within a single
 * sitting, so the session asks for more rather than ending prematurely.
 */
export async function refillQueue(schemeId: string): Promise<QueueRefill> {
  const graph = await getGraph();
  const learner = currentLearner();

  const queue = await studyQueue(graph, learner, schemeId);
  if (queue.length > 0) return { cards: toStudyCards(queue), nextDueIn: null };

  const due = await nextDue(graph, learner, schemeId);
  return { cards: [], nextDueIn: due ? relativeDue(due) : null };
}
