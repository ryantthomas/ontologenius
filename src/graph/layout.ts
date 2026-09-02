/**
 * Layered layout for the prerequisite DAG.
 *
 * The graph is drawn by prerequisite depth rather than by force simulation,
 * because depth is the thing that carries meaning here: a concept's layer is
 * how far into the topic it sits, and edges only ever point rightward. A
 * force-directed blob would look busier and say less.
 */

export interface LayoutNode {
  id: string;
  label: string;
  layer: number;
  row: number;
  pKnown: number;
  available: boolean;
}

export interface LayoutEdge {
  from: string;
  to: string;
}

export interface Layout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  layers: number;
  rows: number;
}

export interface ConceptInput {
  id: string;
  label: string;
  pKnown: number;
  available: boolean;
}

/**
 * Longest-path layering: a concept sits one layer beyond its deepest
 * prerequisite. Cycles cannot occur — the ontology forbids them — but the
 * traversal is still guarded so a malformed graph degrades rather than hangs.
 */
export function layoutGraph(concepts: ConceptInput[], edges: LayoutEdge[]): Layout {
  const incoming = new Map<string, string[]>();
  for (const concept of concepts) incoming.set(concept.id, []);
  for (const edge of edges) {
    if (incoming.has(edge.to)) incoming.get(edge.to)!.push(edge.from);
  }

  const depth = new Map<string, number>();
  const visiting = new Set<string>();

  const depthOf = (id: string): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;

    visiting.add(id);
    const prerequisites = incoming.get(id) ?? [];
    const result = prerequisites.length === 0 ? 0 : Math.max(...prerequisites.map(depthOf)) + 1;
    visiting.delete(id);

    depth.set(id, result);
    return result;
  };

  const byLayer = new Map<number, ConceptInput[]>();
  for (const concept of concepts) {
    const layer = depthOf(concept.id);
    byLayer.set(layer, [...(byLayer.get(layer) ?? []), concept]);
  }

  const nodes: LayoutNode[] = [];
  for (const [layer, members] of byLayer) {
    members
      .sort((a, b) => a.label.localeCompare(b.label))
      .forEach((concept, row) => {
        nodes.push({ ...concept, layer, row });
      });
  }

  return {
    nodes,
    edges: edges.filter((e) => depth.has(e.from) && depth.has(e.to)),
    layers: byLayer.size,
    rows: Math.max(1, ...[...byLayer.values()].map((m) => m.length)),
  };
}
