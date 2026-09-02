import Link from "next/link";
import { notFound } from "next/navigation";
import GraphView from "./GraphView";
import { layoutGraph } from "../../../src/graph/layout";
import { availableConcepts, progress, studyQueue } from "../../../src/graph/study";
import { currentLearner, getGraph } from "../../../src/graph/session";

export const dynamic = "force-dynamic";

export default async function SchemePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const graph = await getGraph();
  const learner = currentLearner();

  const [scheme] = await graph.query(`MATCH (s:Scheme {id: $id}) RETURN s.title AS title`, { id });
  if (!scheme) notFound();

  const [concepts, edges, mastery, available, summary, queue] = await Promise.all([
    graph.query(
      `MATCH (c:Concept)-[:IN_SCHEME]->(s:Scheme {id: $id})
       RETURN c.id AS id, c.pref_label AS label, c.definition AS definition`,
      { id },
    ),
    graph.query(
      `MATCH (a:Concept)-[:PREREQUISITE_OF]->(b:Concept)-[:IN_SCHEME]->(s:Scheme {id: $id})
       RETURN a.id AS from, b.id AS to`,
      { id },
    ),
    graph.query(
      `MATCH (l:Learner {id: $learner})-[m:MASTERY]->(c:Concept)-[:IN_SCHEME]->(s:Scheme {id: $id})
       RETURN c.id AS id, m.p_known AS p_known`,
      { learner, id },
    ),
    availableConcepts(graph, learner, id),
    progress(graph, learner, id),
    studyQueue(graph, learner, id),
  ]);

  const known = new Map(mastery.map((row) => [String(row.id), Number(row.p_known)]));
  const unlocked = new Set(available.map((row) => String(row.id)));

  const layout = layoutGraph(
    concepts.map((c) => ({
      id: String(c.id),
      label: String(c.label),
      pKnown: known.get(String(c.id)) ?? 0,
      available: unlocked.has(String(c.id)),
    })),
    edges.map((e) => ({ from: String(e.from), to: String(e.to) })),
  );

  return (
    <main>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div>
          <h1>{String(scheme.title)}</h1>
          <p className="lede" style={{ marginBottom: 0 }}>
            {summary.concepts} concepts · {queue.length} questions in the next session
          </p>
        </div>
        {queue.length > 0 && (
          <Link className="button" href={`/study/${id}`}>
            Study
          </Link>
        )}
      </div>

      <h2>Progress</h2>
      <div className="stats">
        <div className="stat">
          <div className="value">
            {summary.mastered}
            <span className="muted" style={{ fontSize: 15 }}>
              /{summary.concepts}
            </span>
          </div>
          <div className="label">Mastered</div>
        </div>
        <div className="stat">
          <div className="value">{summary.attempted}</div>
          <div className="label">Attempted</div>
        </div>
        <div className="stat">
          <div className="value">{summary.dueNow}</div>
          <div className="label">Due now</div>
        </div>
        <div className="stat">
          <div className="value">{unlocked.size}</div>
          <div className="label">Unlocked</div>
        </div>
      </div>

      <h2>Prerequisite graph</h2>
      <GraphView layout={layout} />

      {summary.unassessed.length > 0 && (
        <>
          <h2>Concepts with no questions</h2>
          <div className="card">
            <p className="muted" style={{ margin: "0 0 10px", fontSize: 13 }}>
              Mastery only moves on answered questions, so these cannot be mastered — and anything
              downstream of them stays locked. Ask Claude to write items for them.
            </p>
            <ul className="plain">
              {summary.unassessed.map((concept) => (
                <li key={concept.conceptId}>
                  <span>{concept.label}</span>
                  <span className="mono">no items</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {summary.weakest.length > 0 && (
        <>
          <h2>Weakest concepts</h2>
          <div className="card">
            <ul className="plain">
              {summary.weakest.map((concept) => (
                <li key={concept.conceptId}>
                  <span>{concept.label}</span>
                  <span className="mono">{(concept.pKnown * 100).toFixed(0)}%</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      <h2>Concepts</h2>
      <div className="card">
        <ul className="plain">
          {concepts.map((concept) => (
            <li key={String(concept.id)} style={{ display: "block" }}>
              <strong>{String(concept.label)}</strong>
              <div className="muted" style={{ fontSize: 13 }}>
                {String(concept.definition)}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
