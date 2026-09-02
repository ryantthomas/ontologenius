/**
 * Compiles an Ontology into the two things that enforce it:
 * `toDDL` (what the engine checks) and `validateNode` / `validateRelation`
 * (what the engine has no syntax for).
 */
import { propertyDDL, type Ontology, type Property } from "./schema";

// ---------------------------------------------------------------------------
// DDL
// ---------------------------------------------------------------------------

/**
 * Graph schema statements, in dependency order: node tables first, since
 * relation tables reference them. Safe to run on every boot.
 */
export function toDDL(ontology: Ontology): string[] {
  const statements: string[] = [];

  for (const node of Object.values(ontology.nodes)) {
    const columns = node.properties.map((p) => propertyDDL(p, ontology.enums));
    statements.push(
      `CREATE NODE TABLE IF NOT EXISTS ${node.name}(${columns.join(", ")}, PRIMARY KEY (${node.key}))`,
    );
  }

  for (const rel of Object.values(ontology.relations)) {
    const parts = [`FROM ${rel.from} TO ${rel.to}`];
    for (const p of rel.properties) parts.push(propertyDDL(p, ontology.enums));
    statements.push(`CREATE REL TABLE IF NOT EXISTS ${rel.name}(${parts.join(", ")})`);
  }

  return statements;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface Violation {
  path: string;
  message: string;
}

function checkProperties(
  ontology: Ontology,
  owner: string,
  properties: Property[],
  values: Record<string, unknown>,
): Violation[] {
  const violations: Violation[] = [];
  const declared = new Set(properties.map((p) => p.name));

  for (const key of Object.keys(values)) {
    if (!declared.has(key)) {
      violations.push({ path: `${owner}.${key}`, message: `'${key}' is not a property of ${owner}` });
    }
  }

  for (const prop of properties) {
    const value = values[prop.name];

    if (value === undefined || value === null) {
      // The engine stores a missing property as NULL rather than rejecting it,
      // so requiredness is only ever enforced here.
      if (prop.required) {
        violations.push({ path: `${owner}.${prop.name}`, message: `'${prop.name}' is required` });
      }
      continue;
    }

    switch (prop.type.kind) {
      case "enum": {
        const allowed = ontology.enums[prop.type.enumName];
        if (!allowed.includes(String(value))) {
          violations.push({
            path: `${owner}.${prop.name}`,
            message: `'${value}' is not in ${prop.type.enumName} (${allowed.join(", ")})`,
          });
        }
        break;
      }
      case "vector": {
        if (!Array.isArray(value) || value.length !== prop.type.dim) {
          const got = Array.isArray(value) ? `${value.length} dimensions` : typeof value;
          violations.push({
            path: `${owner}.${prop.name}`,
            message: `expected a ${prop.type.dim}-dimension vector, got ${got}`,
          });
        }
        break;
      }
      case "array": {
        if (!Array.isArray(value)) {
          violations.push({ path: `${owner}.${prop.name}`, message: `expected a list, got ${typeof value}` });
        }
        break;
      }
      case "scalar":
        // Type coercion is the engine's job — it rejects a string written to a
        // DOUBLE column — so there is nothing to duplicate here.
        break;
    }
  }

  return violations;
}

/** Check a node's properties before writing it. Empty result means valid. */
export function validateNode(
  ontology: Ontology,
  nodeType: string,
  values: Record<string, unknown>,
): Violation[] {
  const node = ontology.nodes[nodeType];
  if (!node) {
    return [{ path: nodeType, message: `unknown node type '${nodeType}'` }];
  }

  const violations = checkProperties(ontology, nodeType, node.properties, values);

  for (const c of ontology.constraints) {
    if (c.rule !== "min_array_length" || c.node !== nodeType) continue;
    const applies = Object.entries(c.when ?? {}).every(([k, v]) => values[k] === v);
    if (!applies) continue;
    const value = values[c.property];
    if (!Array.isArray(value) || value.length < c.length) {
      const got = Array.isArray(value) ? value.length : 0;
      violations.push({
        path: `${nodeType}.${c.property}`,
        message: `needs at least ${c.length} entries, got ${got}`,
      });
    }
  }

  return violations;
}

/**
 * Check a relation before writing it. The engine also rejects wrong endpoints,
 * but catching it here produces a message an agent can act on rather than a
 * binder exception.
 */
export function validateRelation(
  ontology: Ontology,
  relationType: string,
  fromType: string,
  toType: string,
  values: Record<string, unknown> = {},
): Violation[] {
  const rel = ontology.relations[relationType];
  if (!rel) {
    return [{ path: relationType, message: `unknown relation '${relationType}'` }];
  }

  const violations: Violation[] = [];
  if (rel.from !== fromType || rel.to !== toType) {
    violations.push({
      path: relationType,
      message: `${relationType} goes ${rel.from} -> ${rel.to}, not ${fromType} -> ${toType}`,
    });
  }

  return [...violations, ...checkProperties(ontology, relationType, rel.properties, values)];
}

// ---------------------------------------------------------------------------
// Graph-shape constraints
// ---------------------------------------------------------------------------

/**
 * Would adding `from -> to` close a cycle in an acyclic relation?
 *
 * Prerequisite edges have to stay acyclic or no learning path exists at all
 * (knowledge space theory — Doignon & Falmagne 1985), and the engine has no
 * way to express that. `existingEdges` is the current adjacency for the
 * relation; the check is a walk from `to` looking for `from`.
 */
export function wouldCreateCycle(
  existingEdges: ReadonlyMap<string, readonly string[]>,
  from: string,
  to: string,
): boolean {
  if (from === to) return true;

  const seen = new Set<string>();
  const stack = [to];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === from) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(existingEdges.get(current) ?? []));
  }

  return false;
}

/** The relations declared acyclic in the ontology. */
export function acyclicRelations(ontology: Ontology): string[] {
  return ontology.constraints.filter((c) => c.rule === "acyclic").map((c) => c.relation);
}
