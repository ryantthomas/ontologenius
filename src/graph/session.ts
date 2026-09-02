import "server-only";

import { loadOntology, openGraph, type Graph } from "./db";

/**
 * One graph handle for the whole server process.
 *
 * The database is embedded and single-writer, so a connection per request
 * would serialise badly and waste file handles. Caching on globalThis rather
 * than a module constant keeps a single handle across dev-mode hot reloads.
 */
const cache = globalThis as typeof globalThis & { __ontologeniusGraph?: Promise<Graph> };

export function getGraph(): Promise<Graph> {
  cache.__ontologeniusGraph ??= openGraph(
    process.env.GRAPH_PATH ?? "./data/demo",
    loadOntology(process.env.ONTOLOGY_PATH ?? "ontology/base.yaml"),
  );
  return cache.__ontologeniusGraph;
}

/** Single-user for now; becomes the authenticated subject when multi-user lands. */
export function currentLearner(): string {
  return process.env.LEARNER_ID ?? "me";
}
