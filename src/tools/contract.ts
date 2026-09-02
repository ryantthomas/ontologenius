/**
 * The tool contract — defined once, driven by two callers.
 *
 * The MCP connector (Claude, on the user's own subscription) and the on-site
 * agent loop (a user-supplied API key) both go through these definitions, so
 * neither can reach the graph except through the validated write path.
 *
 * The input schemas are generated from the ontology rather than written by
 * hand. That is the point of declaring the ontology once: the enum values a
 * model is offered in its tool schema are the same values the validator will
 * enforce, so they cannot drift apart.
 */
import { z } from "zod";
import type { Graph } from "../graph/db";
import { progress } from "../graph/study";
import { addConcepts, addItems, openScheme, relate, type WriteResult } from "../graph/write";
import type { Ontology } from "../ontology/schema";

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (graph: Graph, args: Record<string, unknown>) => Promise<unknown>;
}

const schemeId = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

/** An enum from the ontology, as a Zod schema. Throws if it was never declared. */
function ontologyEnum(ontology: Ontology, name: string): z.ZodEnum<[string, ...string[]]> {
  const values = ontology.enums[name];
  if (!values?.length) throw new Error(`ontology declares no enum '${name}'`);
  return z.enum(values as [string, ...string[]]);
}

/**
 * Relations a model may assert: the ones that run between concepts. Learner
 * state (MASTERY, SCHEDULED, ANSWERED) is written by the study loop from real
 * responses and is deliberately not reachable from a tool.
 */
export function assertableRelations(ontology: Ontology): string[] {
  return Object.values(ontology.relations)
    .filter((r) => r.from === "Concept" && r.to === "Concept")
    .map((r) => r.name);
}

/** Summarise a write so a model can see what to fix without re-reading the graph. */
const summarise = (result: WriteResult) => ({
  accepted: result.accepted,
  accepted_count: result.accepted.length,
  rejected: result.rejected.map((r) => ({
    input: r.input,
    violations: r.violations.map((v) => `${v.path}: ${v.message}`),
  })),
});

export function buildTools(ontology: Ontology): ToolDefinition[] {
  const knowledgeType = ontologyEnum(ontology, "knowledge_type");
  const bloomLevel = ontologyEnum(ontology, "bloom_level");
  const itemFormat = ontologyEnum(ontology, "item_format");
  const sourceKind = ontologyEnum(ontology, "source_kind");
  const relations = assertableRelations(ontology);

  const source = z.object({
    kind: sourceKind.describe("What sort of source this is. Prefer primary specifications and peer-reviewed work over secondary summaries."),
    citation: z.string().describe("Human-readable citation, e.g. 'Kafka documentation — Log compaction'."),
    url: z.string().optional(),
  });

  return [
    {
      name: "open_scheme",
      title: "Open a topic",
      description:
        "Start (or reopen) a topic to build a knowledge graph for. Returns the scheme id that every " +
        "other tool takes. Call this first.",
      inputSchema: {
        title: z.string().describe("The topic, e.g. 'Kafka internals'."),
        description: z.string().optional(),
      },
      handler: async (graph, args) => {
        const title = String(args.title);
        const id = schemeId(title);
        const result = await openScheme(graph, {
          id,
          title,
          description: args.description ? String(args.description) : undefined,
        });
        return { scheme: id, ...summarise(result) };
      },
    },

    {
      name: "add_concepts",
      title: "Add concepts",
      description:
        "Add concepts to a topic. Every concept needs a source — the ontology forbids unsourced " +
        "assertions. Definitions should be self-contained and written in your own words rather than " +
        "quoted from the source. Rejected concepts come back with the reason, so fix and resend them. " +
        "Send concepts in batches rather than one call each.",
      inputSchema: {
        scheme: z.string().describe("Scheme id from open_scheme."),
        concepts: z
          .array(
            z.object({
              pref_label: z.string().describe("The concept's preferred name. Unique within the topic."),
              definition: z.string().describe("One self-contained paragraph."),
              knowledge_type: knowledgeType,
              notation: z.string().optional().describe("A domain identifier, if the field has one."),
              difficulty_hint: z
                .number()
                .min(0)
                .max(1)
                .optional()
                .describe("0 easy to 1 hard. Seeds the mastery prior; refined by real responses."),
              source: source,
            }),
          )
          .min(1),
      },
      handler: async (graph, args) =>
        summarise(await addConcepts(graph, String(args.scheme), args.concepts as never)),
    },

    {
      name: "relate",
      title: "Relate concepts",
      description:
        `Assert typed relations between concepts. Available: ${relations.join(", ")}. ` +
        "PREREQUISITE_OF drives the learning path and must stay acyclic — an edge that would close a " +
        "cycle is rejected. BROADER is taxonomic (narrower -> broader). CONTRASTS_WITH marks confusable " +
        "pairs and is used to source multiple-choice distractors. Use concept ids returned by add_concepts.",
      inputSchema: {
        edges: z
          .array(
            z.object({
              relation: z.enum(relations as [string, ...string[]]),
              from: z.string().describe("Concept id."),
              to: z.string().describe("Concept id."),
            }),
          )
          .min(1),
      },
      handler: async (graph, args) => summarise(await relate(graph, args.edges as never)),
    },

    {
      name: "add_items",
      title: "Add practice questions",
      description:
        "Add retrieval-practice questions. Progress only moves on answered questions, so a concept " +
        "with no items can never be mastered and blocks everything downstream of it — check the " +
        "progress tool's unassessed list. Cloze stems must contain {{blank}} where the answer goes. " +
        "Multiple-choice needs at least two distractors, and they should be genuinely tempting: draw " +
        "them from confusable sibling concepts, not from obviously wrong statements. The rationale is " +
        "shown as feedback after answering, so explain why the answer holds.",
      inputSchema: {
        items: z
          .array(
            z.object({
              concept: z.string().describe("Concept id this question tests."),
              format: itemFormat,
              bloom_level: bloomLevel,
              stem: z.string().describe("The question. For cloze, put {{blank}} where the answer belongs."),
              answer: z.string(),
              distractors: z.array(z.string()).optional().describe("Multiple choice only. At least two."),
              rationale: z.string().describe("Why the answer is right — shown as corrective feedback."),
            }),
          )
          .min(1),
      },
      handler: async (graph, args) => summarise(await addItems(graph, args.items as never)),
    },

    {
      name: "progress",
      title: "Read study progress",
      description:
        "What the learner has actually learned: how many concepts are mastered, which are weakest, " +
        "how many reviews are due, and which concepts still have no questions. Read this before " +
        "extending a topic so you add material where it is needed rather than where you left off.",
      inputSchema: {
        scheme: z.string(),
        learner: z.string().optional().describe("Defaults to the connected user."),
      },
      handler: async (graph, args) => {
        const learner = args.learner ? String(args.learner) : (process.env.LEARNER_ID ?? "me");
        const summary = await progress(graph, learner, String(args.scheme));
        return {
          ...summary,
          note:
            summary.unassessed.length > 0
              ? `${summary.unassessed.length} concept(s) have no questions and cannot be mastered — add items for them.`
              : undefined,
        };
      },
    },
  ];
}
