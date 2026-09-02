/**
 * Bayesian Knowledge Tracing — Corbett & Anderson (1995).
 *
 * Mastery of a concept is a latent binary variable. Each answer is noisy
 * evidence about it: a learner who knows the concept can still slip, and one
 * who does not can still guess. After folding in the evidence we allow for the
 * chance that the attempt itself taught them something.
 *
 * This is what the progress bar reads. It is deliberately not "questions
 * answered" — a concept is learned when the posterior passes a threshold,
 * which is the mastery-learning criterion (Bloom 1984), not when it has been
 * seen a certain number of times.
 */

export interface BktParameters {
  /** P(L0) — probability the concept is already known before any practice. */
  pInit: number;
  /** P(T) — probability an unlearned concept becomes learned on an attempt. */
  pLearn: number;
  /** P(S) — probability of answering wrong despite knowing it. */
  pSlip: number;
  /** P(G) — probability of answering right without knowing it. */
  pGuess: number;
}

/**
 * Starting parameters. These are literature-typical values, not fitted ones;
 * fitting them per concept needs response data we do not have on day one.
 * `pGuess` is deliberately below 0.25 so a four-option multiple choice does not
 * read as evidence of knowledge on its own.
 */
export const DEFAULT_BKT: BktParameters = {
  pInit: 0.25,
  pLearn: 0.15,
  pSlip: 0.1,
  pGuess: 0.2,
};

/**
 * The threshold at which a concept counts as mastered. 0.95 is the criterion
 * used by the Cognitive Tutors that BKT was built for (Corbett & Anderson).
 */
export const MASTERY_THRESHOLD = 0.95;

/**
 * Prior for a concept not yet attempted. A concept the graph marks as harder
 * starts lower, so it takes more evidence to call it learned.
 */
export function initialKnowledge(difficultyHint?: number | null, params = DEFAULT_BKT): number {
  if (difficultyHint === undefined || difficultyHint === null) return params.pInit;
  const clamped = Math.min(Math.max(difficultyHint, 0), 1);
  return params.pInit * (1 - clamped);
}

/**
 * Posterior probability the concept is known, after one answer.
 *
 * Two steps, in order: condition on the observation, then apply the learning
 * transition. Doing it the other way round would credit the learner for
 * knowledge acquired *after* the evidence we just saw.
 */
export function updateKnowledge(prior: number, correct: boolean, params = DEFAULT_BKT): number {
  const { pLearn, pSlip, pGuess } = params;

  const likelihoodKnown = correct ? 1 - pSlip : pSlip;
  const likelihoodUnknown = correct ? pGuess : 1 - pGuess;

  const evidence = prior * likelihoodKnown + (1 - prior) * likelihoodUnknown;
  // Degenerate parameters could make the evidence vanish; fall back to the prior
  // rather than dividing by zero.
  const posterior = evidence === 0 ? prior : (prior * likelihoodKnown) / evidence;

  return posterior + (1 - posterior) * pLearn;
}

export function isMastered(pKnown: number): boolean {
  return pKnown >= MASTERY_THRESHOLD;
}
