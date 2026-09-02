import Link from "next/link";
import { notFound } from "next/navigation";
import StudySession from "./StudySession";
import { toStudyCards } from "../../../src/graph/cards";
import { studyQueue } from "../../../src/graph/study";
import { currentLearner, getGraph } from "../../../src/graph/session";

export const dynamic = "force-dynamic";

export default async function StudyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const graph = await getGraph();

  const [scheme] = await graph.query(`MATCH (s:Scheme {id: $id}) RETURN s.title AS title`, { id });
  if (!scheme) notFound();

  const cards = toStudyCards(await studyQueue(graph, currentLearner(), id));

  return (
    <main>
      <div className="row" style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>{String(scheme.title)}</h1>
        <Link className="button secondary" href={`/scheme/${id}`}>
          Back
        </Link>
      </div>

      {cards.length === 0 ? (
        <div className="empty">
          <p style={{ margin: 0 }}>Nothing due right now.</p>
          <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
            Spacing is the point — come back when the next review falls due.
          </p>
        </div>
      ) : (
        <StudySession initialCards={cards} schemeId={id} />
      )}
    </main>
  );
}
