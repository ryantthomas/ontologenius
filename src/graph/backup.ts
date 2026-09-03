/**
 * Backups, and the escape hatch from the storage engine.
 *
 * The graph engine is pre-1.0 and its on-disk format is versioned (storage
 * version 47 at the time of writing). Upgrades are applied in place and are
 * one-way: once a database has been opened by a newer binary, an older one
 * cannot read it. So an upgrade is a migration, and migrations get backed up
 * first.
 *
 * The export is `EXPORT DATABASE`, which writes one Parquet file per table
 * alongside the Cypher DDL that rebuilds the schema. That format is the reason
 * this is a genuine exit and not just a backup: Parquet is readable by DuckDB,
 * pandas, Spark and everything else, so the graph's contents are recoverable
 * even if this engine stops being maintained.
 */
import { mkdirSync, readdirSync, rmSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { openGraph, type Graph } from "./db";
import type { Ontology } from "../ontology/schema";

export interface BackupResult {
  path: string;
  files: string[];
}

/**
 * Export the whole graph to `destination`.
 *
 * The engine requires the target to be empty, so an existing directory is
 * cleared only when `overwrite` is set — silently discarding a previous backup
 * is exactly the wrong default for the one command whose job is not losing
 * data.
 */
export async function backupGraph(
  graph: Graph,
  destination: string,
  { overwrite = false }: { overwrite?: boolean } = {},
): Promise<BackupResult> {
  const path = resolve(destination);

  if (existsSync(path)) {
    if (!overwrite) {
      throw new Error(`${path} already exists — pass overwrite to replace it`);
    }
    rmSync(path, { recursive: true, force: true });
  }
  mkdirSync(dirname(path), { recursive: true });

  // Single-quoted path in Cypher; reject quotes rather than build a broken
  // statement out of a path we cannot escape.
  if (path.includes("'")) throw new Error("backup path may not contain a single quote");
  await graph.query(`EXPORT DATABASE '${path}'`);

  return { path, files: readdirSync(path).sort() };
}

/**
 * Rebuild a graph from a backup, returning the restored handle.
 *
 * This opens the destination itself rather than taking an existing graph,
 * because `IMPORT DATABASE` creates the schema and fails against a catalog that
 * already has it — which every normally-opened graph does. Making the caller
 * pass a path instead of a handle is what stops that mistake being possible.
 */
export async function restoreGraph(
  source: string,
  destination: string,
  ontology: Ontology,
): Promise<Graph> {
  const path = resolve(source);
  if (!existsSync(path)) throw new Error(`no backup at ${path}`);
  if (path.includes("'")) throw new Error("backup path may not contain a single quote");

  const graph = await openGraph(destination, ontology, { applySchema: false });
  try {
    await graph.query(`IMPORT DATABASE '${path}'`);
  } catch (error) {
    await graph.close();
    throw error;
  }
  return graph;
}
