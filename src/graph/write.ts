/**
 * The single validated write path into the graph.
 *
 * Both drivers — the MCP connector and the on-site agent loop — go through
 * these functions, so neither can bypass the ontology. Nothing throws on
 * invalid input: each call returns what it accepted alongside what it rejected
 * and why, because the caller is usually a language model that can correct
 * itself if told what was wrong.
 */
import { validateNode, validateRelation, wouldCreateCycle, type Violation } from "../ontology/compile";
import type { Graph } from "./db";

export interface Rejection {
  input: unknown;
  violations: Violation[];
}

export interface WriteResult {
  accepted: string[];
  rejected: Rejection[];
}

/**
 * Concept ids are `<scheme>:<slug>`, which makes the ontology's
 * `unique_within(Concept.pref_label, IN_SCHEME)` constraint fall out of the
 * engine's primary-key uniqueness instead of needing a query to check it.
 */
export function conceptId(schemeId: string, prefLabel: string): string {
  const slug = prefLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `${schemeId}:${slug}`;
}

/** Write a node, listing only the properties actually supplied. */
async function insertNode(
  graph: Graph,
  label: string,
  values: Record<string, unknown>,
  timestampProperty?: string,
): Promise<void> {
  const present = Object.entries(values).filter(([, v]) => v !== undefined && v !== null);
  const assignments = present.map(([k]) => `${k}: $${k}`);
  if (timestampProperty) assignments.push(`${timestampProperty}: current_timestamp()`);
  const params = Object.fromEntries(present);
  await graph.query(`CREATE (n:${label} {${assignments.join(", ")}})`, params);
}

async function insertEdge(
  graph: Graph,
  relation: string,
  fromLabel: string,
  fromId: string,
  toLabel: string,
  toId: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  const fromKey = graph.ontology.nodes[fromLabel].key;
  const toKey = graph.ontology.nodes[toLabel].key;
  const present = Object.entries(properties).filter(([, v]) => v !== undefined && v !== null);
  const assignments = present.length ? ` {${present.map(([k]) => `${k}: $p_${k}`).join(", ")}}` : "";

  await graph.query(
    `MATCH (a:${fromLabel} {${fromKey}: $from}), (b:${toLabel} {${toKey}: $to})
     CREATE (a)-[:${relation}${assignments}]->(b)`,
    { from: fromId, to: toId, ...Object.fromEntries(present.map(([k, v]) => [`p_${k}`, v])) },
  );
}

// ---------------------------------------------------------------------------
// Schemes
// ---------------------------------------------------------------------------

export async function openScheme(
  graph: Graph,
  input: { id: string; title: string; description?: string },
): Promise<WriteResult> {
  const values = { id: input.id, title: input.title, description: input.description ?? "" };
  const violations = validateNode(graph.ontology, "Scheme", { ...values, created_at: "generated" });
  if (violations.length) return { accepted: [], rejected: [{ input, violations }] };

  const existing = await graph.query(`MATCH (s:Scheme {id: $id}) RETURN s.id AS id`, { id: input.id });
  if (existing.length === 0) await insertNode(graph, "Scheme", values, "created_at");

  return { accepted: [input.id], rejected: [] };
}

// ---------------------------------------------------------------------------
// Concepts
// ---------------------------------------------------------------------------

export interface SourceInput {
  kind: string;
  citation: string;
  url?: string;
}

export interface ConceptInput {
  pref_label: string;
  definition: string;
  knowledge_type: string;
  notation?: string;
  difficulty_hint?: number;
  /** Required: the ontology forbids unsourced assertions. */
  source: SourceInput;
}

/**
 * Add concepts to a scheme. Each concept is written together with its source
 * and the CITES edge, so the ontology's `at_least_one CITES` constraint cannot
 * be violated by a partial write.
 */
export async function addConcepts(
  graph: Graph,
  schemeId: string,
  concepts: ConceptInput[],
): Promise<WriteResult> {
  const result: WriteResult = { accepted: [], rejected: [] };

  const scheme = await graph.query(`MATCH (s:Scheme {id: $id}) RETURN s.id AS id`, { id: schemeId });
  if (scheme.length === 0) {
    return {
      accepted: [],
      rejected: concepts.map((input) => ({
        input,
        violations: [{ path: "scheme", message: `no scheme '${schemeId}' — call open_scheme first` }],
      })),
    };
  }

  for (const input of concepts) {
    const id = conceptId(schemeId, input.pref_label);
    const values = {
      id,
      pref_label: input.pref_label,
      definition: input.definition,
      knowledge_type: input.knowledge_type,
      notation: input.notation,
      difficulty_hint: input.difficulty_hint,
    };

    const violations = [
      ...validateNode(graph.ontology, "Concept", { ...values, created_at: "generated" }),
      ...validateNode(graph.ontology, "Source", {
        id: "generated",
        kind: input.source?.kind,
        citation: input.source?.citation,
        url: input.source?.url,
        retrieved_at: "generated",
      }).map((v) => ({ ...v, path: v.path.replace(/^Source/, "source") })),
    ];

    if (violations.length) {
      result.rejected.push({ input, violations });
      continue;
    }

    const duplicate = await graph.query(`MATCH (c:Concept {id: $id}) RETURN c.id AS id`, { id });
    if (duplicate.length > 0) {
      result.rejected.push({
        input,
        violations: [{ path: "Concept.pref_label", message: `'${input.pref_label}' already exists in this scheme` }],
      });
      continue;
    }

    const sourceId = `${id}#src`;
    await insertNode(graph, "Concept", values, "created_at");
    await insertNode(
      graph,
      "Source",
      { id: sourceId, kind: input.source.kind, citation: input.source.citation, url: input.source.url },
      "retrieved_at",
    );
    await insertEdge(graph, "IN_SCHEME", "Concept", id, "Scheme", schemeId);
    await insertEdge(graph, "CITES", "Concept", id, "Source", sourceId);

    result.accepted.push(id);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export interface EdgeInput {
  relation: string;
  from: string;
  to: string;
}

/** Current adjacency for a relation, used for the acyclicity check. */
async function adjacency(graph: Graph, relation: string): Promise<Map<string, string[]>> {
  const rows = await graph.query(
    `MATCH (a)-[:${relation}]->(b) RETURN a.id AS from, b.id AS to`,
  );
  const edges = new Map<string, string[]>();
  for (const row of rows) {
    const from = String(row.from);
    edges.set(from, [...(edges.get(from) ?? []), String(row.to)]);
  }
  return edges;
}

/**
 * Add typed edges between concepts. Relations declared `acyclic` in the
 * ontology are checked before each write — a prerequisite cycle would leave the
 * topic with no valid learning path at all.
 */
export async function relate(graph: Graph, edges: EdgeInput[]): Promise<WriteResult> {
  const result: WriteResult = { accepted: [], rejected: [] };
  const acyclic = new Set(
    graph.ontology.constraints.filter((c) => c.rule === "acyclic").map((c) => c.relation),
  );
  const adjacencyCache = new Map<string, Map<string, string[]>>();

  for (const input of edges) {
    const relation = graph.ontology.relations[input.relation];
    if (!relation) {
      result.rejected.push({
        input,
        violations: [{ path: input.relation, message: `unknown relation '${input.relation}'` }],
      });
      continue;
    }

    const violations = validateRelation(graph.ontology, input.relation, relation.from, relation.to);
    const endpoints = await graph.query(
      `MATCH (a:${relation.from} {id: $from}), (b:${relation.to} {id: $to}) RETURN a.id AS a, b.id AS b`,
      { from: input.from, to: input.to },
    );
    if (endpoints.length === 0) {
      violations.push({ path: input.relation, message: `no such ${relation.from}/${relation.to} pair` });
    }

    if (acyclic.has(input.relation) && violations.length === 0) {
      if (!adjacencyCache.has(input.relation)) {
        adjacencyCache.set(input.relation, await adjacency(graph, input.relation));
      }
      const existing = adjacencyCache.get(input.relation)!;
      if (wouldCreateCycle(existing, input.from, input.to)) {
        violations.push({
          path: input.relation,
          message: `would create a cycle in ${input.relation}, which must stay acyclic`,
        });
      } else {
        existing.set(input.from, [...(existing.get(input.from) ?? []), input.to]);
      }
    }

    if (violations.length) {
      result.rejected.push({ input, violations });
      continue;
    }

    await insertEdge(graph, input.relation, relation.from, input.from, relation.to, input.to);
    result.accepted.push(`${input.from} -[${input.relation}]-> ${input.to}`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export interface ItemInput {
  concept: string;
  format: string;
  bloom_level: string;
  stem: string;
  answer: string;
  rationale: string;
  distractors?: string[];
}

/** Add retrieval-practice items, each bound to exactly one concept. */
export async function addItems(graph: Graph, items: ItemInput[]): Promise<WriteResult> {
  const result: WriteResult = { accepted: [], rejected: [] };

  for (const [index, input] of items.entries()) {
    const id = `${input.concept}#q${Date.now().toString(36)}${index}`;
    const values = {
      id,
      format: input.format,
      bloom_level: input.bloom_level,
      stem: input.stem,
      answer: input.answer,
      rationale: input.rationale,
      distractors: input.distractors ?? [],
    };

    const violations = validateNode(graph.ontology, "Item", { ...values, created_at: "generated" });

    const concept = await graph.query(`MATCH (c:Concept {id: $id}) RETURN c.id AS id`, {
      id: input.concept,
    });
    if (concept.length === 0) {
      violations.push({ path: "concept", message: `no concept '${input.concept}'` });
    }

    if (violations.length) {
      result.rejected.push({ input, violations });
      continue;
    }

    await insertNode(graph, "Item", values, "created_at");
    await insertEdge(graph, "ASSESSES", "Item", id, "Concept", input.concept);
    result.accepted.push(id);
  }

  return result;
}
