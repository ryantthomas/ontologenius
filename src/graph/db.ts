/**
 * Graph handle: an embedded LadybugDB instance with the ontology's schema
 * applied. The DDL is idempotent, so this runs on every boot.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import lbug from "@ladybugdb/core";
import { toDDL } from "../ontology/compile";
import { parseOntology, type Ontology } from "../ontology/schema";

export type Row = Record<string, unknown>;

/** Buffer pool for ":memory:" graphs — enough for tests, small enough to run many. */
const IN_MEMORY_BUFFER_POOL_BYTES = 64 * 1024 * 1024;

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
  // The engine will not create intermediate directories for a new database.
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  }

  // An ephemeral graph gets a modest buffer pool. The engine's default reserves
  // a share of system memory, which is right for a real database but exhausts
  // the address space when a test suite opens several at once.
  const database =
    databasePath === ":memory:"
      ? new lbug.Database(databasePath, IN_MEMORY_BUFFER_POOL_BYTES)
      : new lbug.Database(databasePath);
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
