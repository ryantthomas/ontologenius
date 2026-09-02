/**
 * Graph handle: an embedded LadybugDB instance with the ontology's schema
 * applied. The DDL is idempotent, so this runs on every boot.
 */
import { readFileSync } from "node:fs";
import lbug from "@ladybugdb/core";
import { toDDL } from "../ontology/compile.js";
import { parseOntology, type Ontology } from "../ontology/schema.js";

export type Row = Record<string, unknown>;

export interface Graph {
  ontology: Ontology;
  /** Run a Cypher statement, optionally with `$name` parameters. */
  query(statement: string, params?: Record<string, unknown>): Promise<Row[]>;
  close(): Promise<void>;
}

/** Read and parse an ontology file from disk. */
export function loadOntology(path: string): Ontology {
  return parseOntology(readFileSync(path, "utf8"));
}

/**
 * Open (or create) a graph at `databasePath` and bring its schema up to date.
 * Pass ":memory:" for an ephemeral graph — that is what the tests use.
 */
export async function openGraph(databasePath: string, ontology: Ontology): Promise<Graph> {
  const database = new lbug.Database(databasePath);
  const connection = new lbug.Connection(database);

  const query = async (statement: string, params?: Record<string, unknown>): Promise<Row[]> => {
    const result = params
      ? await connection.execute(await connection.prepare(statement), params as never)
      : await connection.query(statement);

    // Multi-statement queries return an array; we only ever read the last result.
    const single = Array.isArray(result) ? result[result.length - 1] : result;
    return (await single.getAll()) as Row[];
  };

  for (const statement of toDDL(ontology)) {
    await query(statement);
  }

  return {
    ontology,
    query,
    close: async () => {
      await connection.close();
      await database.close();
    },
  };
}
