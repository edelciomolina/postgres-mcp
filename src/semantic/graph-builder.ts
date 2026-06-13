import type { Pool } from "pg";
import type {
  DatabaseGraph,
  TableNode,
  ColumnNode,
  ForeignKeyEdge,
  IndexInfo
} from "./graph-types.js";
import { classifyColumn } from "./table-classifier.js";
import { classifyTable } from "./risk-classifier.js";
import { inferRelations } from "./relationship-inferer.js";
import { inferDomains } from "./relationship-inferer.js";
import type { McpConfig } from "../config.js";

/**
 * Builds the in-memory DatabaseGraph by querying information_schema and
 * pg_catalog. Never writes to the user's database.
 *
 * The graph is built once at startup (or on-demand) and cached in memory.
 * All inferred/classified data is tagged with isInferred: true.
 */
export async function buildDatabaseGraph(
  pool: Pool,
  config: McpConfig,
  schemasToScan?: string[]
): Promise<DatabaseGraph> {
  const client = await pool.connect();
  try {
    // 1. Database name
    const dbRes = await client.query<{ current_database: string }>(
      "SELECT current_database()"
    );
    const databaseName = dbRes.rows[0].current_database;

    // 2. Schemas (exclude blocked ones)
    const blockedSchemas = config.security.blockedSchemas;
    const schemaRes = await client.query<{ schema_name: string }>(
      `SELECT schema_name
       FROM information_schema.schemata
       WHERE schema_name NOT IN (${blockedSchemas.map((_, i) => `$${i + 1}`).join(", ")})
         AND schema_name NOT LIKE 'pg_toast%'
         AND schema_name NOT LIKE 'pg_temp%'
       ORDER BY schema_name`,
      blockedSchemas
    );
    const schemas = schemaRes.rows.map((r) => r.schema_name);

    const targetSchemas =
      schemasToScan && schemasToScan.length > 0
        ? schemas.filter((s) => schemasToScan.includes(s))
        : schemas;

    if (targetSchemas.length === 0) {
      return emptyGraph(databaseName, schemas);
    }

    const schemaParams = targetSchemas.map((_, i) => `$${i + 1}`).join(", ");

    // 3. Tables and views
    const tableRes = await client.query<{
      table_schema: string;
      table_name: string;
      table_type: string;
    }>(
      `SELECT table_schema, table_name, table_type
       FROM information_schema.tables
       WHERE table_schema IN (${schemaParams})
       ORDER BY table_schema, table_name`,
      targetSchemas
    );

    // 4. Columns for all tables at once
    const colRes = await client.query<{
      table_schema: string;
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `SELECT table_schema, table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema IN (${schemaParams})
       ORDER BY table_schema, table_name, ordinal_position`,
      targetSchemas
    );

    // 5. Foreign keys
    const fkRes = await client.query<{
      constraint_name: string;
      table_schema: string;
      table_name: string;
      column_name: string;
      foreign_table_schema: string;
      foreign_table_name: string;
      foreign_column_name: string;
      delete_rule: string;
      update_rule: string;
    }>(
      `SELECT
         tc.constraint_name,
         tc.table_schema,
         tc.table_name,
         kcu.column_name,
         ccu.table_schema  AS foreign_table_schema,
         ccu.table_name    AS foreign_table_name,
         ccu.column_name   AS foreign_column_name,
         rc.delete_rule,
         rc.update_rule
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name
         AND tc.table_schema = ccu.table_schema
       LEFT JOIN information_schema.referential_constraints rc
         ON tc.constraint_name = rc.constraint_name
         AND tc.table_schema = rc.constraint_schema
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema IN (${schemaParams})
       ORDER BY tc.table_schema, tc.table_name, tc.constraint_name`,
      targetSchemas
    );

    // 6. Indexes
    const idxRes = await client.query<{
      schemaname: string;
      tablename: string;
      indexname: string;
      indexdef: string;
    }>(
      `SELECT schemaname, tablename, indexname, indexdef
       FROM pg_indexes
       WHERE schemaname IN (${schemaParams})
       ORDER BY schemaname, tablename, indexname`,
      targetSchemas
    );

    // 7. Row estimates from pg_class (best-effort, not exact)
    const rowEstimateRes = await client.query<{
      schemaname: string;
      relname: string;
      n_live_tup: string;
    }>(
      `SELECT schemaname, relname, n_live_tup
       FROM pg_stat_user_tables
       WHERE schemaname IN (${schemaParams})`,
      targetSchemas
    );

    // 8. Primary key columns (to mark semanticRole)
    const pkRes = await client.query<{
      table_schema: string;
      table_name: string;
      column_name: string;
    }>(
      `SELECT tc.table_schema, tc.table_name, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
       WHERE tc.constraint_type = 'PRIMARY KEY'
         AND tc.table_schema IN (${schemaParams})`,
      targetSchemas
    );

    // Build lookup maps
    const rowEstimateMap = new Map<string, number>();
    for (const r of rowEstimateRes.rows) {
      rowEstimateMap.set(
        `${r.schemaname}.${r.relname}`,
        parseInt(r.n_live_tup, 10)
      );
    }

    const pkSet = new Set<string>();
    for (const r of pkRes.rows) {
      pkSet.add(`${r.table_schema}.${r.table_name}.${r.column_name}`);
    }

    const fkSet = new Set<string>();
    for (const r of fkRes.rows) {
      fkSet.add(`${r.table_schema}.${r.table_name}.${r.column_name}`);
    }

    // Group columns by table
    const colsByTable = new Map<string, ColumnNode[]>();
    for (const r of colRes.rows) {
      const key = `${r.table_schema}.${r.table_name}`;
      if (!colsByTable.has(key)) colsByTable.set(key, []);
      const isPk = pkSet.has(
        `${r.table_schema}.${r.table_name}.${r.column_name}`
      );
      const isFk = fkSet.has(
        `${r.table_schema}.${r.table_name}.${r.column_name}`
      );
      const col = classifyColumn(
        r.column_name,
        r.data_type,
        r.is_nullable === "YES",
        r.column_default,
        isPk,
        isFk,
        config.semanticLayer.sensitiveKeywords
      );
      colsByTable.get(key)!.push(col);
    }

    // Build foreign key edges
    const foreignKeys: ForeignKeyEdge[] = fkRes.rows.map((r) => ({
      constraintName: r.constraint_name,
      fromSchema: r.table_schema,
      fromTable: r.table_name,
      fromColumn: r.column_name,
      toSchema: r.foreign_table_schema,
      toTable: r.foreign_table_name,
      toColumn: r.foreign_column_name,
      onDelete: r.delete_rule || null,
      onUpdate: r.update_rule || null
    }));

    // Build index info
    const indexes: IndexInfo[] = idxRes.rows.map((r) => {
      const isUnique = r.indexdef.toLowerCase().includes("unique");
      const isPrimary = r.indexname.endsWith("_pkey");
      // Parse columns from indexdef: "... ON table USING method (col1, col2)"
      const colMatch = r.indexdef.match(/\(([^)]+)\)$/);
      const columns = colMatch
        ? colMatch[1].split(",").map((c) => c.trim().replace(/^"(.*)"$/, "$1"))
        : [];
      return {
        schema: r.schemaname,
        table: r.tablename,
        indexName: r.indexname,
        columns,
        isUnique,
        isPrimary
      };
    });

    // Build table nodes
    const tables: TableNode[] = tableRes.rows.map((r) => {
      const key = `${r.table_schema}.${r.table_name}`;
      const columns = colsByTable.get(key) ?? [];
      const rowEstimate = rowEstimateMap.get(key) ?? null;
      return classifyTable(
        r.table_schema,
        r.table_name,
        r.table_type,
        columns,
        rowEstimate,
        config.security.blockedTables
      );
    });

    // Infer relations (only if enabled in config)
    const inferredRelations = config.semanticLayer
      .inferRelationsWithoutForeignKeys
      ? inferRelations(tables, foreignKeys)
      : [];

    // Infer business domains
    const domains = config.semanticLayer.inferBusinessEntities
      ? inferDomains(tables, foreignKeys, inferredRelations)
      : [];

    return {
      databaseName,
      builtAt: new Date().toISOString(),
      schemas,
      tables,
      foreignKeys,
      inferredRelations,
      indexes,
      domains,
      _note:
        "Inferred fields are derived from naming patterns and heuristics. They are hints, not guarantees."
    };
  } finally {
    client.release();
  }
}

function emptyGraph(databaseName: string, schemas: string[]): DatabaseGraph {
  return {
    databaseName,
    builtAt: new Date().toISOString(),
    schemas,
    tables: [],
    foreignKeys: [],
    inferredRelations: [],
    indexes: [],
    domains: [],
    _note:
      "Inferred fields are derived from naming patterns and heuristics. They are hints, not guarantees."
  };
}
