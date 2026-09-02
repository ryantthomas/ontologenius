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

## Why these components

| Choice | Rationale |
|---|---|
| **[LadybugDB](https://ladybugdb.com/)** (`@ladybugdb/core`, MIT) | Embedded property-graph database — "SQLite for graphs." Successor to KuzuDB, which Apple acquired and archived in Oct 2025. Cypher, columnar storage, ACID, plus vector and full-text indices in-process. Its **required predefined schema** is what enforces the ontology: illegal node types, relation types, and property values are rejected by the database itself, not by hand-written validation. |
| **[ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)** (MIT) | The FSRS scheduler, already written and empirically tuned. We schedule reviews; we do not invent a scheduling algorithm. |
| **[SKOS](https://www.w3.org/TR/skos-reference/)** (W3C Recommendation) | Standard semantics for taxonomy and nomenclature: `prefLabel`, `altLabel`, `notation`, `broader`, `related`, `inScheme`. The vocabulary layer is standards-backed rather than bespoke. |
| **Bloom's revised taxonomy** (Anderson & Krathwohl, 2001) | Supplies the enumerations every concept and item is typed by — the knowledge dimension and the cognitive process level. Enforced as database enums. |
| **Zod + YAML** | The ontology is declared once in YAML, validated by Zod, compiled to graph DDL. Adding a domain is configuration, not code. |

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
