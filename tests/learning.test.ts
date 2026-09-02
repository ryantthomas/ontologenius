import { describe, expect, it } from "vitest";
import {
  DEFAULT_BKT,
  MASTERY_THRESHOLD,
  initialKnowledge,
  isMastered,
  updateKnowledge,
} from "../src/learning/bkt.js";
import { Rating, dueFirst, newSchedule, ratingFor, review } from "../src/learning/fsrs.js";

describe("knowledge tracing", () => {
  it("raises the posterior on a correct answer and lowers it on a wrong one", () => {
    const prior = initialKnowledge();
    expect(updateKnowledge(prior, true)).toBeGreaterThan(prior);
    expect(updateKnowledge(prior, false)).toBeLessThan(updateKnowledge(prior, true));
  });

  it("does not call a concept mastered off a single lucky answer", () => {
    // The point of a guess parameter: one right answer is weak evidence.
    expect(isMastered(updateKnowledge(initialKnowledge(), true))).toBe(false);
  });

  it("converges above the mastery threshold under sustained correctness", () => {
    let p = initialKnowledge();
    for (let i = 0; i < 8; i++) p = updateKnowledge(p, true);
    expect(p).toBeGreaterThan(MASTERY_THRESHOLD);
  });

  it("recovers rather than collapsing after a slip", () => {
    let p = initialKnowledge();
    for (let i = 0; i < 8; i++) p = updateKnowledge(p, true);
    const afterSlip = updateKnowledge(p, false);
    expect(afterSlip).toBeLessThan(p);
    expect(afterSlip).toBeGreaterThan(0.5);
  });

  it("keeps the posterior a probability under any sequence", () => {
    let p = initialKnowledge();
    for (const correct of [true, false, false, true, true, false, true]) {
      p = updateKnowledge(p, correct);
      expect(p).toBeGreaterThan(0);
      expect(p).toBeLessThan(1);
    }
  });

  it("starts harder concepts from a lower prior", () => {
    expect(initialKnowledge(0.9)).toBeLessThan(initialKnowledge(0.1));
    expect(initialKnowledge(undefined)).toBe(DEFAULT_BKT.pInit);
  });

  it("survives degenerate parameters without dividing by zero", () => {
    const degenerate = { pInit: 0, pLearn: 0, pSlip: 0, pGuess: 0 };
    expect(Number.isFinite(updateKnowledge(0, true, degenerate))).toBe(true);
  });
});

describe("scheduling", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  it("makes a new item due immediately", () => {
    expect(newSchedule(now).due.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it("pushes the due date out and counts the repetition", () => {
    const next = review(newSchedule(now), ratingFor(true), now);
    expect(next.due.getTime()).toBeGreaterThan(now.getTime());
    expect(next.reps).toBe(1);
  });

  it("schedules a failed item sooner than a passed one", () => {
    const start = newSchedule(now);
    const failed = review(start, ratingFor(false), now);
    const passed = review(start, ratingFor(true), now);
    expect(failed.due.getTime()).toBeLessThan(passed.due.getTime());
  });

  it("lengthens the interval as an item is repeatedly recalled", () => {
    let state = newSchedule(now);
    let at = now;
    const intervals: number[] = [];

    for (let i = 0; i < 4; i++) {
      const next = review(state, Rating.Good, at);
      intervals.push(next.due.getTime() - at.getTime());
      state = next;
      at = next.due;
    }

    expect(intervals.at(-1)!).toBeGreaterThan(intervals[0]);
  });

  it("returns only overdue items, soonest first", () => {
    const items = [
      { id: "later", due: new Date("2026-01-03T00:00:00Z") },
      { id: "overdue", due: new Date("2025-12-30T00:00:00Z") },
      { id: "just-due", due: new Date("2026-01-01T00:00:00Z") },
    ];
    expect(dueFirst(items, now).map((i) => i.id)).toEqual(["overdue", "just-due"]);
  });
});
