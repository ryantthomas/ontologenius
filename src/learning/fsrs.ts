/**
 * Review scheduling, delegated to FSRS via `ts-fsrs`.
 *
 * Distributed practice is one of only two techniques rated high-utility by
 * Dunlosky et al. (2013), and the spacing effect it exploits is among the most
 * replicated results in the literature (Cepeda et al. 2006). The scheduling
 * algorithm itself is a solved problem, so this module is only a translation
 * layer between the graph's SCHEDULED edge and an FSRS card.
 */
import { Rating, State, createEmptyCard, fsrs, type Card, type Grade } from "ts-fsrs";

/** The FSRS card as stored on the SCHEDULED edge. */
export interface ScheduleState {
  due: Date;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  state: number;
  scheduled_days: number;
  learning_steps: number;
  last_review?: Date;
}

const scheduler = fsrs();

const toCard = (state: ScheduleState): Card => ({
  due: state.due,
  stability: state.stability,
  difficulty: state.difficulty,
  elapsed_days: 0,
  scheduled_days: state.scheduled_days,
  learning_steps: state.learning_steps,
  reps: state.reps,
  lapses: state.lapses,
  state: state.state as State,
  last_review: state.last_review,
});

const fromCard = (card: Card): ScheduleState => ({
  due: card.due,
  stability: card.stability,
  difficulty: card.difficulty,
  reps: card.reps,
  lapses: card.lapses,
  state: card.state,
  scheduled_days: card.scheduled_days,
  learning_steps: card.learning_steps,
  last_review: card.last_review,
});

/** Schedule for an item the learner has never seen. Due immediately. */
export function newSchedule(now: Date = new Date()): ScheduleState {
  return fromCard(createEmptyCard(now));
}

/**
 * Map a graded answer onto an FSRS rating.
 *
 * FSRS expects a four-point self-report. Auto-graded items only tell us right
 * or wrong, so a wrong answer is `Again` and a right one is `Good`. Where the
 * learner does self-report — which is the mode FSRS was tuned for — pass the
 * grade through instead of inferring it.
 */
export function ratingFor(correct: boolean): Grade {
  return correct ? Rating.Good : Rating.Again;
}

/** Apply one review and return the item's next schedule. */
export function review(state: ScheduleState, grade: Grade, now: Date = new Date()): ScheduleState {
  return fromCard(scheduler.next(toCard(state), now, grade).card);
}

/** Items whose due date has passed, soonest first — the review queue. */
export function dueFirst<T extends { due: Date }>(items: T[], now: Date = new Date()): T[] {
  return items.filter((i) => i.due <= now).sort((a, b) => a.due.getTime() - b.due.getTime());
}

export { Rating, State };
