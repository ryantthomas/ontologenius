import type { StudyItem } from "./study";

/** What the client is allowed to know about an item: never the answer. */
export interface StudyCard {
  itemId: string;
  conceptLabel: string;
  format: string;
  stem: string;
  choices: string[];
}

/**
 * Stable per-item shuffle. Options must not reorder between renders, and a
 * fixed order would eventually let position stand in for recall.
 */
export function shuffleFor(seed: string, values: string[]): string[] {
  const hash = [...seed].reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) >>> 0, 7);
  return values
    .map((value, index) => ({ value, rank: ((hash + index * 2654435761) >>> 0) % 997 }))
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.value);
}

/** Strip answers and shuffle choices before anything reaches the browser. */
export function toStudyCards(queue: StudyItem[]): StudyCard[] {
  return queue.map((item) => ({
    itemId: item.itemId,
    conceptLabel: item.conceptLabel,
    format: item.format,
    stem: item.stem,
    choices:
      item.format === "multiple_choice" ? shuffleFor(item.itemId, [item.answer, ...item.distractors]) : [],
  }));
}
