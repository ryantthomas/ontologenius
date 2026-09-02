import Link from "next/link";
import { progress } from "../src/graph/study";
import { currentLearner, getGraph } from "../src/graph/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const graph = await getGraph();
  const learner = currentLearner();

  const schemes = await graph.query(
    `MATCH (s:Scheme) RETURN s.id AS id, s.title AS title, s.description AS description`,
  );

  const withProgress = await Promise.all(
    schemes.map(async (scheme) => ({
      id: String(scheme.id),
      title: String(scheme.title),
      description: String(scheme.description ?? ""),
      progress: await progress(graph, learner, String(scheme.id)),
    })),
  );

  return (
    <main>
      <h1>Your topics</h1>
      <p className="lede">
        Each topic is a knowledge graph built through Claude and governed by the ontology. Progress
        below is the share of concepts whose mastery estimate has passed threshold — not the number
        of questions you have answered.
      </p>

      {withProgress.length === 0 ? (
        <div className="empty">
          <p style={{ margin: 0 }}>No topics yet.</p>
          <p style={{ margin: "8px 0 0" }} className="mono">
            npm run seed
          </p>
        </div>
      ) : (
        withProgress.map((scheme) => {
          const share = scheme.progress.concepts
            ? scheme.progress.mastered / scheme.progress.concepts
            : 0;

          return (
            <Link key={scheme.id} href={`/scheme/${scheme.id}`} className="card card-link">
              <div className="row">
                <div>
                  <strong>{scheme.title}</strong>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {scheme.progress.mastered} of {scheme.progress.concepts} concepts mastered
                    {scheme.progress.dueNow > 0 && ` · ${scheme.progress.dueNow} due`}
                  </div>
                </div>
                <div style={{ width: 140 }}>
                  <div className="meter">
                    <span style={{ width: `${Math.round(share * 100)}%` }} />
                  </div>
                </div>
              </div>
            </Link>
          );
        })
      )}
    </main>
  );
}
