/**
 * The ontology file format.
 *
 * One YAML declaration produces two enforcement mechanisms:
 *
 *   - graph DDL      — structure and property types, enforced by LadybugDB itself
 *                      (unknown labels, unknown properties, wrong relation
 *                      endpoints, type mismatches and duplicate keys are all
 *                      rejected by the engine)
 *   - a validator    — everything the engine has no syntax for: enum membership,
 *                      required properties, and graph-shape rules
 *
 * The split is not a design preference. LadybugDB 0.20 has no ENUM type, no
 * NOT NULL and no CHECK, so those checks have to live above the engine. Keeping
 * both mechanisms generated from the same file is what stops them drifting.
 */
import { parse as parseYaml } from "yaml";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Property types
// ---------------------------------------------------------------------------

export type PropertyType =
  | { kind: "scalar"; ddl: string }
  | { kind: "enum"; enumName: string }
  | { kind: "array"; ddl: string }
  | { kind: "vector"; dim: number };

export interface Property {
  name: string;
  type: PropertyType;
  required: boolean;
}

const SCALARS: Record<string, string> = {
  string: "STRING",
  int64: "INT64",
  double: "DOUBLE",
  bool: "BOOLEAN",
  timestamp: "TIMESTAMP",
};

/**
 * Parse a property type as written in the YAML, e.g.
 *   `string`  `string?`  `int64`  `string[]`  `float[384]?`  `enum(bloom_level)`
 * A trailing `?` marks the property optional; everything else is required.
 */
export function parsePropertyType(name: string, spec: string): Property {
  const required = !spec.endsWith("?");
  const body = required ? spec : spec.slice(0, -1);

  const enumMatch = /^enum\(([A-Za-z_][A-Za-z0-9_]*)\)$/.exec(body);
  if (enumMatch) {
    return { name, required, type: { kind: "enum", enumName: enumMatch[1] } };
  }

  const vectorMatch = /^float\[(\d+)\]$/.exec(body);
  if (vectorMatch) {
    return { name, required, type: { kind: "vector", dim: Number(vectorMatch[1]) } };
  }

  const arrayMatch = /^([a-z0-9]+)\[\]$/.exec(body);
  if (arrayMatch) {
    const inner = SCALARS[arrayMatch[1]];
    if (!inner) throw new Error(`Unknown array element type '${arrayMatch[1]}' on property '${name}'`);
    return { name, required, type: { kind: "array", ddl: `${inner}[]` } };
  }

  const scalar = SCALARS[body];
  if (!scalar) throw new Error(`Unknown property type '${spec}' on property '${name}'`);
  return { name, required, type: { kind: "scalar", ddl: scalar } };
}

/** The DDL fragment for a property, e.g. `embedding FLOAT[384]`. */
export function propertyDDL(prop: Property, enums: Record<string, string[]>): string {
  switch (prop.type.kind) {
    case "scalar":
    case "array":
      return `${prop.name} ${prop.type.ddl}`;
    case "vector":
      return `${prop.name} FLOAT[${prop.type.dim}]`;
    case "enum":
      if (!enums[prop.type.enumName]) {
        throw new Error(`Property '${prop.name}' references undeclared enum '${prop.type.enumName}'`);
      }
      // No ENUM type in the engine — stored as STRING, membership checked by the validator.
      return `${prop.name} STRING`;
  }
}

// ---------------------------------------------------------------------------
// Constraint rules — the checks the engine cannot express
// ---------------------------------------------------------------------------

const constraintSchema = z.discriminatedUnion("rule", [
  z.object({ rule: z.literal("exactly_one"), node: z.string(), relation: z.string() }),
  z.object({ rule: z.literal("at_least_one"), node: z.string(), relation: z.string() }),
  z.object({ rule: z.literal("acyclic"), relation: z.string() }),
  z.object({
    rule: z.literal("unique_within"),
    node: z.string(),
    property: z.string(),
    scope: z.string(),
  }),
  z.object({
    rule: z.literal("min_array_length"),
    node: z.string(),
    property: z.string(),
    length: z.number().int().positive(),
    when: z.record(z.string()).optional(),
  }),
]);

export type Constraint = z.infer<typeof constraintSchema>;

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

const relationSchema = z.object({
  from: z.string(),
  to: z.string(),
  properties: z.record(z.string()).optional(),
});

const nodeSchema = z.object({
  key: z.string(),
  properties: z.record(z.string()),
});

const fileSchema = z.object({
  version: z.number().int().positive(),
  enums: z.record(z.array(z.string()).nonempty()).default({}),
  nodes: z.record(nodeSchema),
  relations: z.record(relationSchema),
  constraints: z.array(constraintSchema).default([]),
});

export interface NodeType {
  name: string;
  key: string;
  properties: Property[];
}

export interface RelationType {
  name: string;
  from: string;
  to: string;
  properties: Property[];
}

export interface Ontology {
  version: number;
  enums: Record<string, string[]>;
  nodes: Record<string, NodeType>;
  relations: Record<string, RelationType>;
  constraints: Constraint[];
}

/**
 * Parse and check an ontology file. Throws on anything that would produce an
 * invalid graph schema: unknown types, undeclared enums, relations pointing at
 * node types that do not exist, or a key that is not a declared property.
 */
export function parseOntology(yamlText: string): Ontology {
  const raw = fileSchema.parse(parseYaml(yamlText));

  const nodes: Record<string, NodeType> = {};
  for (const [name, def] of Object.entries(raw.nodes)) {
    const properties = Object.entries(def.properties).map(([p, spec]) => parsePropertyType(p, spec));
    if (!properties.some((p) => p.name === def.key)) {
      throw new Error(`Node type '${name}' declares key '${def.key}' which is not one of its properties`);
    }
    nodes[name] = { name, key: def.key, properties };
  }

  const relations: Record<string, RelationType> = {};
  for (const [name, def] of Object.entries(raw.relations)) {
    for (const endpoint of [def.from, def.to]) {
      if (!nodes[endpoint]) {
        throw new Error(`Relation '${name}' references unknown node type '${endpoint}'`);
      }
    }
    const properties = Object.entries(def.properties ?? {}).map(([p, spec]) => parsePropertyType(p, spec));
    relations[name] = { name, from: def.from, to: def.to, properties };
  }

  // Enums must exist before the validator can check membership against them.
  for (const node of Object.values(nodes)) {
    for (const prop of node.properties) {
      if (prop.type.kind === "enum" && !raw.enums[prop.type.enumName]) {
        throw new Error(`Node '${node.name}.${prop.name}' references undeclared enum '${prop.type.enumName}'`);
      }
    }
  }

  for (const c of raw.constraints) {
    if ("node" in c && !nodes[c.node]) {
      throw new Error(`Constraint references unknown node type '${c.node}'`);
    }
    if ("relation" in c && !relations[c.relation]) {
      throw new Error(`Constraint references unknown relation '${c.relation}'`);
    }
  }

  return { version: raw.version, enums: raw.enums, nodes, relations, constraints: raw.constraints };
}
