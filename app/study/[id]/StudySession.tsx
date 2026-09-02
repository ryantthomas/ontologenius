"use client";

import Link from "next/link";
import { useState } from "react";
import { refillQueue, submitAnswer, type GradedAnswer } from "../../actions";
import type { StudyCard } from "../../../src/graph/cards";

/** Render the cloze placeholder as an actual blank rather than as its markup. */
function Stem({ text }: { text: string }) {
  const parts = text.split("{{blank}}");
  return (
    <>
      {parts.map((part, index) => (
        <span key={index}>
          {part}
          {index < parts.length - 1 && (
            <span
              style={{
                display: "inline-block",
                minWidth: 72,
                borderBottom: "2px solid var(--accent)",
                verticalAlign: "baseline",
              }}
            />
          )}
        </span>
      ))}
    </>
  );
}

export default function StudySession({
  initialCards,
  schemeId,
}: {
  initialCards: StudyCard[];
  schemeId: string;
}) {
  const [cards, setCards] = useState(initialCards);
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<GradedAnswer | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [score, setScore] = useState({ correct: 0, answered: 0 });
  const [finished, setFinished] = useState<{ nextDueIn: string | null } | null>(null);

  const card = cards[index];

  if (finished || !card) {
    return (
      <div className="empty">
        <p style={{ margin: 0 }}>
          Session complete — {score.correct} of {score.answered} correct.
        </p>
        {finished?.nextDueIn && (
          <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
            Next review due {finished.nextDueIn}. Spacing is the point.
          </p>
        )}
        <p style={{ margin: "16px 0 0" }}>
          <Link className="button" href={`/scheme/${schemeId}`}>
            Back to the graph
          </Link>
        </p>
      </div>
    );
  }

  const answer = async (response: string) => {
    if (pending || result) return;
    setPending(true);
    setChosen(response);
    try {
      const graded = await submitAnswer(card.itemId, response, Date.now() - startedAt);
      setResult(graded);
      setScore((s) => ({ correct: s.correct + (graded.correct ? 1 : 0), answered: s.answered + 1 }));
    } finally {
      setPending(false);
    }
  };

  const next = async () => {
    setResult(null);
    setChosen(null);
    setTyped("");
    setStartedAt(Date.now());

    if (index + 1 < cards.length) {
      setIndex(index + 1);
      return;
    }

    // Queue exhausted: an item failed earlier is due again within minutes, and
    // a concept unlocked during this session has questions of its own.
    setPending(true);
    try {
      const refill = await refillQueue(schemeId);
      if (refill.cards.length > 0) {
        setCards(refill.cards);
        setIndex(0);
      } else {
        setFinished({ nextDueIn: refill.nextDueIn });
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="muted" style={{ fontSize: 13 }}>
          {card.conceptLabel}
        </span>
        <span className="mono">
          {score.answered} answered
        </span>
      </div>

      <div className="card">
        <p style={{ margin: 0, fontSize: 17, lineHeight: 1.7 }}>
          <Stem text={card.stem} />
        </p>

        {card.choices.length > 0 ? (
          <div className="choices">
            {card.choices.map((choice) => {
              const isChosen = chosen === choice;
              const isAnswer = result?.answer === choice;
              const className = result
                ? isAnswer
                  ? "choice correct"
                  : isChosen
                    ? "choice wrong"
                    : "choice"
                : "choice";

              return (
                <button
                  key={choice}
                  className={className}
                  disabled={pending || result !== null}
                  onClick={() => answer(choice)}
                >
                  {choice}
                </button>
              );
            })}
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (typed.trim()) answer(typed);
            }}
          >
            <input
              type="text"
              value={typed}
              autoFocus
              placeholder="Type your answer"
              disabled={result !== null}
              onChange={(event) => setTyped(event.target.value)}
            />
            {!result && (
              <button
                className="button"
                type="submit"
                disabled={pending || !typed.trim()}
                style={{ marginTop: 12 }}
              >
                Check
              </button>
            )}
          </form>
        )}

        {result && (
          <div className="feedback">
            <strong>{result.correct ? "Correct." : `Not quite — the answer is “${result.answer}”.`}</strong>
            <div>{result.rationale}</div>
            <div style={{ marginTop: 8, fontSize: 13 }}>
              Mastery {(result.pKnown * 100).toFixed(0)}%
              {result.mastered && " — mastered"} · next review {result.dueIn}
            </div>
            <button className="button" onClick={next} disabled={pending} style={{ marginTop: 14 }}>
              Next
            </button>
          </div>
        )}
      </div>
    </>
  );
}
