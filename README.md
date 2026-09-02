# Ontologenius

Build a rigorously-structured knowledge graph about anything you need to learn,
then study it through an interface driven by learning-science research.

Two things separate this from a flashcard app:

1. **The graph is ontology-governed.** Node types, relation types, controlled
   vocabularies and provenance are declared once and enforced on every write — so
   a language model cannot pollute the graph with ad-hoc structure.
2. **Every pedagogical mechanism cites a study.** A feature with no citation in
   [`docs/evidence.md`](docs/evidence.md) does not ship.

## How it works

```
  Claude (your subscription)             Site chat (your own API key)
          │  MCP connector                         │  Messages API tool-use
          └───────────────┬─────────────────────────┘
                          ▼
               ONE TOOL CONTRACT  (JSON Schema, defined once)
                          │
                          ▼
               ontology-constrained write layer
                          │
                          ▼
                     LadybugDB  ◄──── reads ──── Next.js UI
                                                 (graph · path · study · progress)
```

There are two ways to fill the graph, and you pick whichever suits you:

- **Connect your Claude subscription** (default). Add this as a custom MCP
  connector in claude.ai or Claude Desktop, then just talk to Claude: *"I need to
  learn Kafka's replication protocol."* Claude researches the topic and writes it
  into your graph. No API key, no per-token cost — it runs on the subscription you
  already pay for. The conversation lives in Claude's window; this site is the
  study surface.
- **Bring your own API key.** Prefer one window? Paste an API key and the site
  runs the same agent itself, chat included.

Both drivers go through the *same* validated write path, so neither can bypass the
ontology. The tools are defined once as JSON Schema and adapted to each.

Then, on the site: the graph renders, a prerequisite-ordered learning path appears,
and you study by retrieval practice — cloze and multiple choice, scheduled by FSRS,
with mastery estimated per concept. Claude can read that progress back and aim the
next session at your weak spots.

## The graph changes as you learn

Grain size is a modelling decision, and it can be wrong: a concept you keep failing
is often not one concept but several wearing a single label. So a concept that
survives repeated practice without being learned is reported back as **ready to
break down**. Claude splits it into parts, links them with `PART_OF`, and gives
the parts their own questions. The whole is then withheld until its parts are
known, and reassessed as the sum of them.

This is the one mechanism that edits the *graph* in response to performance rather
than only the schedule — the qualitative form of splitting a knowledge component
when the response data says it is not atomic. `PART_OF` is deliberately distinct
from `BROADER`: knowing every *kind of* something is not knowing it, whereas
knowing every *part* is exactly what composition claims.

## Why these components

| Choice | Rationale |
|---|---|
| **[LadybugDB](https://ladybugdb.com/)** (`@ladybugdb/core`, MIT) | Embedded property-graph database — "SQLite for graphs." Successor to KuzuDB, which Apple acquired and archived in Oct 2025. Cypher, columnar storage, ACID, plus vector and full-text indices in-process. Its **required predefined schema** does half the enforcement for free (see below). |
| **[ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)** (MIT) | The FSRS scheduler, already written and empirically tuned. We schedule reviews; we do not invent a scheduling algorithm. |
| **[SKOS](https://www.w3.org/TR/skos-reference/)** (W3C Recommendation) | Standard semantics for taxonomy and nomenclature: `prefLabel`, `altLabel`, `notation`, `broader`, `related`, `inScheme`. The vocabulary layer is standards-backed rather than bespoke. |
| **Bloom's revised taxonomy** (Anderson & Krathwohl, 2001) | Supplies the enumerations every concept and item is typed by — the knowledge dimension and the cognitive process level. Enforced as database enums. |
| **Zod + YAML** | The ontology is declared once in YAML, validated by Zod, compiled to graph DDL. Adding a domain is configuration, not code. |

## How the ontology is enforced

`ontology/base.yaml` is declared once and compiles to **two** enforcement
mechanisms, because neither covers the whole job:

| Enforced by the engine | Enforced by the generated validator |
|---|---|
| Unknown node or relation types | Enum membership |
| Undeclared properties | Required properties |
| Wrong relation endpoints | Vector dimensions |
| Property type mismatches | Acyclic prerequisite edges |
| Duplicate primary keys | Graph-shape rules (`exactly_one`, `at_least_one`, `min_array_length`) |

The split is not a preference. LadybugDB 0.20 has no `ENUM` type, no `NOT NULL`
and no `CHECK`, and it stores a missing property as NULL rather than rejecting
it — so those checks have to live above the engine. Generating both from the same
file is what keeps them from drifting apart.

Violations come back as a list of `{path, message}` rather than a thrown error,
so an agent writing to the graph can read what it got wrong and correct itself.

## Connecting Claude

Point Claude Desktop at the local server — no hosting, no API key, no OAuth.
Add this to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "ontologenius": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/ontologenius/src/mcp/server.ts"],
      "env": { "GRAPH_PATH": "/absolute/path/to/ontologenius/data/demo" }
    }
  }
}
```

Then just talk to Claude — *"I need to learn Kafka's replication protocol"* — and
run `npm run dev` to study what it built. Both processes read the same graph file.

The five tools Claude gets are generated from the ontology, so the enum values it
is offered are exactly the ones the validator enforces:

| Tool | Purpose |
|---|---|
| `open_scheme` | Start a topic; returns the id the other tools take |
| `add_concepts` | Add concepts, each with a required source |
| `relate` | Assert `PREREQUISITE_OF`, `BROADER`, `CONTRASTS_WITH`, … between concepts |
| `add_items` | Add cloze and multiple-choice questions |
| `progress` | Read mastery, weak spots, and which concepts still lack questions |

Nothing throws. Each write reports what it accepted and what it rejected with
reasons, so Claude can correct itself and resend — a prerequisite cycle, a
multiple-choice item with too few distractors, or a concept missing a source all
come back as an explanation rather than a stack trace.

## Layout

```
ontology/base.yaml      upper ontology — invented once, shared by all topics
ontology/domains/       per-topic overlays (subtypes + controlled vocabulary)
src/ontology/           YAML -> Zod -> LadybugDB DDL compiler
src/graph/              graph client, Cypher queries, learning-path traversal
src/learning/           FSRS scheduling + Bayesian knowledge tracing
src/tools/              the shared tool contract and its validated write path
src/mcp/                MCP adapter — what Claude connects to
src/agent/              BYOK adapter — the on-site agent loop
app/                    Next.js site — graph view, study session, progress
scripts/seed.ts         demo graph without an LLM
docs/evidence.md        every design decision -> the study behind it
docs/ontology.md        the ontology, in prose
```

## Status

Early. Milestone 1 (ontology compiler and graph bootstrap) in progress.
