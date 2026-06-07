#!/usr/bin/env node
/**
 * @edelciomolina/postgres-mcp
 * MCP server for PostgreSQL - reads credentials from .env at runtime.
 *
 * Author: Edelcio Molina <https://github.com/edelciomolina>
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { Pool } from "pg";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Default read-only tools - no writes, no DDL, no arbitrary SQL
// ---------------------------------------------------------------------------
export const DEFAULT_READONLY_TOOLS: readonly string[] = [
  "pg_execute_query",
  "pg_manage_query",
  "pg_inspect_schema",
  "pg_get_setup_instructions",
  "pg_analyze_database",
  "pg_monitor_database",
  "pg_debug_database"
];

/**
 * Tools that can write, alter, or drop database objects.
 * Must be explicitly opted-in via `tool=<name>` args in mcp.json
 * AND require POSTGRES_MCP_ALLOW_WRITE=true in the environment.
 */
export const WRITE_CAPABLE_TOOLS: readonly string[] = [
  "pg_manage_schema",
  "pg_manage_indexes",
  "pg_manage_constraints",
  "pg_manage_functions",
  "pg_manage_triggers",
  "pg_manage_rls",
  "pg_manage_users",
  "pg_execute_mutation",
  "pg_execute_sql"
];

/**
 * All tool names this server can expose.
 * Write-capable tools require explicit opt-in AND POSTGRES_MCP_ALLOW_WRITE=true.
 */
export const SUPPORTED_TOOLS: readonly string[] = [
  ...DEFAULT_READONLY_TOOLS,
  ...WRITE_CAPABLE_TOOLS
];

// ---------------------------------------------------------------------------
// .env reader
// ---------------------------------------------------------------------------
export function loadEnvFile(envPath: string): Record<string, string> {
  if (!existsSync(envPath)) {
    throw new Error(`.env file not found at: ${envPath}`);
  }

  const env: Record<string, string> = {};
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    env[key] = value;
  }
  return env;
}

// ---------------------------------------------------------------------------
// Resolve credential from .env using MCP_KEY_* mapping
// ---------------------------------------------------------------------------
export function resolveCredential(
  envVars: Record<string, string>,
  dotenv: Record<string, string>,
  mcpKey: string,
  fallback: string
): string {
  const mappedKey = envVars[mcpKey] ?? fallback;
  const value = dotenv[mappedKey] ?? "";
  return value;
}

// ---------------------------------------------------------------------------
// Build PostgreSQL connection string with URL-encoded password
// ---------------------------------------------------------------------------
export function buildConnectionString(creds: {
  host: string;
  port: string;
  name: string;
  sslmode: string;
  user: string;
  pass: string;
}): string {
  const encodedUser = encodeURIComponent(creds.user);
  const encodedPass = encodeURIComponent(creds.pass);
  return `postgresql://${encodedUser}:${encodedPass}@${creds.host}:${creds.port}/${creds.name}?sslmode=${creds.sslmode}`;
}

// ---------------------------------------------------------------------------
// Walk up directory tree to find .env
// ---------------------------------------------------------------------------
export function findEnvFile(startDir: string): string | null {
  let dir = startDir;
  while (true) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, "..");
    if (parent === dir) return null;
    dir = parent;
  }
}

// ---------------------------------------------------------------------------
// Multi-statement query guard
// ---------------------------------------------------------------------------
export function hasMultipleStatements(query: string): boolean {
  const stripped = query.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  const withoutTrailing = stripped.trim().replace(/;+\s*$/, "");
  return withoutTrailing.includes(";");
}

// ---------------------------------------------------------------------------
// Write-operation guard
// ---------------------------------------------------------------------------
export function isWriteOperation(query: string): boolean {
  const stripped = query
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "")
    .trim();
  // Block all DDL, DML, and maintenance commands
  if (
    /^(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP|CREATE|ALTER|REPLACE|GRANT|REVOKE|COPY|CALL|DO|VACUUM|ANALYZE|REINDEX|CLUSTER|COMMENT)\b/i.test(
      stripped
    )
  ) {
    return true;
  }
  // Block EXPLAIN ANALYZE (executes the query): handles both
  // `EXPLAIN ANALYZE ...` and `EXPLAIN (ANALYZE ...) ...` forms
  if (/^EXPLAIN\b/i.test(stripped) && /\bANALYZE\b/i.test(stripped)) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Instructions injected into the MCP initialize response
// ---------------------------------------------------------------------------
export const MCP_INSTRUCTIONS =
  "PostgreSQL query rules:\n" +
  '1. Always call pg_inspect_schema(operation="get_info", tableName="<table>") before ' +
  "writing any query that references specific column names.\n" +
  "2. Never send multiple SQL statements separated by semicolons in a single " +
  "pg_execute_query call - split each statement into a separate tool invocation.\n" +
  '3. For row counts, prefer operation="count" over embedding SELECT COUNT inside a ' +
  "multi-statement query.\n" +
  "4. Permission boundaries: if a tool rejects an operation due to insufficient " +
  "permissions, stop immediately and inform the user - do NOT attempt to work around " +
  "the restriction via terminal commands, psql, reading .env files, or any other means. " +
  "Clearly state which tool was used, what permission it lacks, and what configuration " +
  "change would be needed to perform the operation.";

// ---------------------------------------------------------------------------
// Helper: format tool output
// ---------------------------------------------------------------------------
function ok(data: unknown): { content: [{ type: "text"; text: string }] } {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

function fail(message: string): {
  content: [{ type: "text"; text: string }];
  isError: true;
} {
  return { content: [{ type: "text", text: message }], isError: true };
}

// ---------------------------------------------------------------------------
// Register all tools on the MCP server
// ---------------------------------------------------------------------------
function registerTools(
  server: McpServer,
  pool: Pool,
  enabledTools: readonly string[]
): void {
  function enabled(name: string): boolean {
    return enabledTools.includes(name);
  }

  // -------------------------------------------------------------------------
  // pg_execute_query
  // -------------------------------------------------------------------------
  if (enabled("pg_execute_query")) {
    server.tool(
      "pg_execute_query",
      'Execute SELECT queries and data retrieval operations - operation="select/count/exists" with query and optional parameters.',
      {
        operation: z
          .enum(["select", "count", "exists"])
          .describe("Query operation: select, count, or exists"),
        query: z.string().describe("SQL SELECT query"),
        parameters: z
          .array(z.unknown())
          .optional()
          .default([])
          .describe("Prepared statement parameters ($1, $2, ...)"),
        limit: z
          .number()
          .optional()
          .describe("Maximum rows to return (safety limit)"),
        timeout: z.number().optional().describe("Query timeout in ms")
      },
      async ({ operation, query, parameters = [], limit, timeout }) => {
        if (hasMultipleStatements(query)) {
          return fail(
            "Error: Multi-statement queries (multiple SQL statements separated by semicolons) are not allowed. " +
              "Split each statement into a separate pg_execute_query call."
          );
        }
        if (isWriteOperation(query)) {
          return fail(
            "Permission denied: pg_execute_query only supports read-only operations " +
              "(SELECT / COUNT / EXISTS). Write operations (INSERT, UPDATE, DELETE, DDL) " +
              "are not permitted in this MCP configuration.\n\n" +
              "Do NOT attempt to work around this restriction using terminal commands, " +
              "psql, reading .env files, or any other means. " +
              "To perform write operations, the MCP server must be reconfigured to " +
              "include a write-enabled tool (e.g. pg_execute_sql)."
          );
        }

        const client = await pool.connect();
        try {
          if (timeout)
            await client.query(
              `SET LOCAL statement_timeout = ${Number(timeout)}`
            );

          if (operation === "count") {
            const wrapped = `SELECT COUNT(*) AS count FROM (${query}) _q`;
            const res = await client.query(wrapped, parameters as unknown[]);
            return ok({ count: Number(res.rows[0].count) });
          }

          if (operation === "exists") {
            const wrapped = `SELECT EXISTS(${query}) AS exists`;
            const res = await client.query(wrapped, parameters as unknown[]);
            return ok({ exists: res.rows[0].exists as boolean });
          }

          let finalQuery = query;
          if (limit !== undefined) {
            finalQuery = `SELECT * FROM (${query}) _q LIMIT ${Number(limit)}`;
          }
          const res = await client.query(finalQuery, parameters as unknown[]);
          return ok({ rowCount: res.rowCount, rows: res.rows });
        } finally {
          client.release();
        }
      }
    );
  }

  // -------------------------------------------------------------------------
  // pg_manage_schema
  // -------------------------------------------------------------------------
  if (enabled("pg_manage_schema")) {
    server.tool(
      "pg_manage_schema",
      "Manage PostgreSQL schema - get schema info, create/alter tables, manage enums.",
      {
        operation: z
          .enum([
            "get_info",
            "create_table",
            "alter_table",
            "get_enums",
            "create_enum"
          ])
          .describe("Operation to perform"),
        schema: z
          .string()
          .optional()
          .default("public")
          .describe("Schema name (defaults to public)"),
        tableName: z.string().optional().describe("Table name"),
        columns: z
          .array(
            z.object({
              name: z.string(),
              type: z.string(),
              nullable: z.boolean().optional().default(true),
              default: z.string().optional()
            })
          )
          .optional()
          .describe("Columns for create_table"),
        operations: z
          .array(
            z.object({
              type: z.enum(["add", "alter", "drop"]),
              columnName: z.string(),
              dataType: z.string().optional(),
              nullable: z.boolean().optional(),
              default: z.string().optional()
            })
          )
          .optional()
          .describe("Column operations for alter_table"),
        enumName: z.string().optional().describe("ENUM type name"),
        values: z
          .array(z.string())
          .optional()
          .describe("ENUM values for create_enum"),
        ifNotExists: z
          .boolean()
          .optional()
          .default(false)
          .describe("Use IF NOT EXISTS")
      },
      async ({
        operation,
        schema = "public",
        tableName,
        columns,
        operations,
        enumName,
        values,
        ifNotExists = false
      }) => {
        const client = await pool.connect();
        try {
          if (operation === "get_info") {
            if (tableName) {
              const colRes = await client.query(
                `SELECT column_name, data_type, is_nullable, column_default
                 FROM information_schema.columns
                 WHERE table_schema = $1 AND table_name = $2
                 ORDER BY ordinal_position`,
                [schema, tableName]
              );
              const conRes = await client.query(
                `SELECT tc.constraint_name, tc.constraint_type, kcu.column_name,
                         ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
                 FROM information_schema.table_constraints tc
                 JOIN information_schema.key_column_usage kcu
                   ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
                 LEFT JOIN information_schema.constraint_column_usage ccu
                   ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
                 WHERE tc.table_schema = $1 AND tc.table_name = $2`,
                [schema, tableName]
              );
              return ok({
                table: tableName,
                schema,
                columns: colRes.rows,
                constraints: conRes.rows
              });
            }
            const res = await client.query(
              `SELECT table_name, table_type FROM information_schema.tables
               WHERE table_schema = $1 ORDER BY table_name`,
              [schema]
            );
            return ok({ schema, tables: res.rows });
          }

          if (operation === "get_enums") {
            const params: unknown[] = [schema];
            let sql = `SELECT t.typname AS enum_name, e.enumlabel AS value, e.enumsortorder AS sort_order
                       FROM pg_type t
                       JOIN pg_enum e ON t.oid = e.enumtypid
                       JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
                       WHERE n.nspname = $1`;
            if (enumName) {
              sql += ` AND t.typname = $2`;
              params.push(enumName);
            }
            sql += ` ORDER BY t.typname, e.enumsortorder`;
            const res = await client.query(sql, params);
            return ok(res.rows);
          }

          if (operation === "create_table") {
            if (!tableName || !columns?.length)
              return fail(
                "tableName and columns are required for create_table"
              );
            const colDefs = columns
              .map((c) => {
                let def = `"${c.name}" ${c.type}`;
                if (c.nullable === false) def += " NOT NULL";
                if (c.default !== undefined) def += ` DEFAULT ${c.default}`;
                return def;
              })
              .join(", ");
            const ifne = ifNotExists ? "IF NOT EXISTS " : "";
            await client.query(
              `CREATE TABLE ${ifne}"${schema}"."${tableName}" (${colDefs})`
            );
            return ok({ created: tableName, schema });
          }

          if (operation === "alter_table") {
            if (!tableName || !operations?.length)
              return fail(
                "tableName and operations are required for alter_table"
              );
            const stmts: string[] = [];
            for (const op of operations) {
              if (op.type === "add") {
                let def = `ADD COLUMN "${op.columnName}" ${op.dataType}`;
                if (op.nullable === false) def += " NOT NULL";
                if (op.default !== undefined) def += ` DEFAULT ${op.default}`;
                stmts.push(def);
              } else if (op.type === "alter") {
                if (op.dataType)
                  stmts.push(
                    `ALTER COLUMN "${op.columnName}" TYPE ${op.dataType}`
                  );
                if (op.nullable === false)
                  stmts.push(`ALTER COLUMN "${op.columnName}" SET NOT NULL`);
                else if (op.nullable === true)
                  stmts.push(`ALTER COLUMN "${op.columnName}" DROP NOT NULL`);
                if (op.default !== undefined)
                  stmts.push(
                    `ALTER COLUMN "${op.columnName}" SET DEFAULT ${op.default}`
                  );
              } else if (op.type === "drop") {
                stmts.push(`DROP COLUMN "${op.columnName}"`);
              }
            }
            await client.query(
              `ALTER TABLE "${schema}"."${tableName}" ${stmts.join(", ")}`
            );
            return ok({ altered: tableName, schema });
          }

          if (operation === "create_enum") {
            if (!enumName || !values?.length)
              return fail("enumName and values are required for create_enum");
            const valList = values
              .map((v) => `'${v.replace(/'/g, "''")}'`)
              .join(", ");
            const ifne = ifNotExists ? "IF NOT EXISTS " : "";
            await client.query(
              `CREATE TYPE ${ifne}"${schema}"."${enumName}" AS ENUM (${valList})`
            );
            return ok({ created: enumName, schema, values });
          }

          return fail(`Unknown operation: ${operation}`);
        } finally {
          client.release();
        }
      }
    );
  }

  // -------------------------------------------------------------------------
  // pg_inspect_schema  (read-only: get_info + get_enums only)
  // -------------------------------------------------------------------------
  if (enabled("pg_inspect_schema")) {
    server.tool(
      "pg_inspect_schema",
      "Inspect PostgreSQL schema - list tables and columns, view ENUM types. Read-only.",
      {
        operation: z
          .enum(["get_info", "get_enums"])
          .describe("Operation to perform"),
        schema: z
          .string()
          .optional()
          .default("public")
          .describe("Schema name (defaults to public)"),
        tableName: z.string().optional().describe("Table name for get_info"),
        enumName: z
          .string()
          .optional()
          .describe("ENUM type name filter for get_enums")
      },
      async ({ operation, schema = "public", tableName, enumName }) => {
        const client = await pool.connect();
        try {
          if (operation === "get_info") {
            if (tableName) {
              const colRes = await client.query(
                `SELECT column_name, data_type, is_nullable, column_default
                 FROM information_schema.columns
                 WHERE table_schema = $1 AND table_name = $2
                 ORDER BY ordinal_position`,
                [schema, tableName]
              );
              const conRes = await client.query(
                `SELECT tc.constraint_name, tc.constraint_type, kcu.column_name,
                         ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
                 FROM information_schema.table_constraints tc
                 JOIN information_schema.key_column_usage kcu
                   ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
                 LEFT JOIN information_schema.constraint_column_usage ccu
                   ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
                 WHERE tc.table_schema = $1 AND tc.table_name = $2`,
                [schema, tableName]
              );
              return ok({
                table: tableName,
                schema,
                columns: colRes.rows,
                constraints: conRes.rows
              });
            }
            const res = await client.query(
              `SELECT table_name, table_type FROM information_schema.tables
               WHERE table_schema = $1 ORDER BY table_name`,
              [schema]
            );
            return ok({ schema, tables: res.rows });
          }

          if (operation === "get_enums") {
            const params: unknown[] = [schema];
            let sql = `SELECT t.typname AS enum_name, e.enumlabel AS value, e.enumsortorder AS sort_order
                       FROM pg_type t
                       JOIN pg_enum e ON t.oid = e.enumtypid
                       JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
                       WHERE n.nspname = $1`;
            if (enumName) {
              sql += ` AND t.typname = $2`;
              params.push(enumName);
            }
            sql += ` ORDER BY t.typname, e.enumsortorder`;
            const res = await client.query(sql, params);
            return ok(res.rows);
          }

          return fail(`Unknown operation: ${operation}`);
        } finally {
          client.release();
        }
      }
    );
  }

  // -------------------------------------------------------------------------
  // pg_manage_indexes
  // -------------------------------------------------------------------------
  if (enabled("pg_manage_indexes")) {
    server.tool(
      "pg_manage_indexes",
      "Manage PostgreSQL indexes - get, create, drop, reindex, and analyze usage.",
      {
        operation: z
          .enum(["get", "create", "drop", "reindex", "analyze_usage"])
          .describe("Operation to perform"),
        schema: z.string().optional().default("public").describe("Schema name"),
        tableName: z.string().optional().describe("Table name"),
        indexName: z.string().optional().describe("Index name"),
        columns: z.array(z.string()).optional().describe("Columns for create"),
        unique: z.boolean().optional().default(false).describe("Unique index"),
        concurrent: z
          .boolean()
          .optional()
          .default(false)
          .describe("CREATE/DROP CONCURRENTLY"),
        method: z
          .enum(["btree", "hash", "gist", "spgist", "gin", "brin"])
          .optional()
          .describe("Index method"),
        where: z.string().optional().describe("Partial index condition"),
        ifNotExists: z
          .boolean()
          .optional()
          .default(false)
          .describe("IF NOT EXISTS for create"),
        ifExists: z
          .boolean()
          .optional()
          .default(true)
          .describe("IF EXISTS for drop"),
        cascade: z
          .boolean()
          .optional()
          .default(false)
          .describe("CASCADE for drop"),
        type: z
          .enum(["index", "table", "schema", "database"])
          .optional()
          .describe("Reindex target type"),
        target: z.string().optional().describe("Reindex target name"),
        minSizeBytes: z
          .number()
          .optional()
          .default(0)
          .describe("Min index size in bytes for analyze_usage"),
        showUnused: z
          .boolean()
          .optional()
          .default(true)
          .describe("Show indexes with zero scans"),
        includeStats: z
          .boolean()
          .optional()
          .default(true)
          .describe("Include usage stats in get")
      },
      async ({
        operation,
        schema = "public",
        tableName,
        indexName,
        columns,
        unique = false,
        concurrent = false,
        method,
        where,
        ifNotExists = false,
        ifExists = true,
        cascade = false,
        type,
        target,
        minSizeBytes = 0,
        showUnused = true,
        includeStats = true
      }) => {
        const client = await pool.connect();
        try {
          if (operation === "get") {
            if (includeStats) {
              const params: unknown[] = [schema];
              let sql = `SELECT psi.schemaname, psi.tablename, psi.indexname,
                           psi.idx_scan AS scans, psi.idx_tup_read AS tuples_read,
                           psi.idx_tup_fetch AS tuples_fetched,
                           pg_relation_size(psi.indexrelname::regclass) AS size_bytes,
                           pg_size_pretty(pg_relation_size(psi.indexrelname::regclass)) AS size_pretty,
                           pi.indisunique AS is_unique, pi.indisprimary AS is_primary
                         FROM pg_stat_user_indexes psi
                         JOIN pg_index pi ON psi.indexrelid = pi.indexrelid
                         WHERE psi.schemaname = $1`;
              if (tableName) {
                sql += ` AND psi.tablename = $2`;
                params.push(tableName);
              }
              sql += ` ORDER BY size_bytes DESC, scans DESC`;
              const res = await client.query(sql, params);
              return ok(res.rows);
            }
            const params: unknown[] = [schema];
            let sql = `SELECT schemaname, tablename, indexname, indexdef,
                         pg_size_pretty(pg_relation_size(indexname::regclass)) AS size
                       FROM pg_indexes WHERE schemaname = $1`;
            if (tableName) {
              sql += ` AND tablename = $2`;
              params.push(tableName);
            }
            sql += ` ORDER BY tablename, indexname`;
            const res = await client.query(sql, params);
            return ok(res.rows);
          }

          if (operation === "create") {
            if (!indexName || !tableName || !columns?.length)
              return fail(
                "indexName, tableName, and columns are required for create"
              );
            const uniqueClause = unique ? "UNIQUE " : "";
            const concurrentClause = concurrent ? "CONCURRENTLY " : "";
            const methodClause = method ? ` USING ${method}` : "";
            const whereClause = where ? ` WHERE ${where}` : "";
            const ifne = ifNotExists ? "IF NOT EXISTS " : "";
            await client.query(
              `CREATE ${uniqueClause}INDEX ${concurrentClause}${ifne}"${indexName}" ON "${schema}"."${tableName}"${methodClause} (${columns.map((c) => `"${c}"`).join(", ")})${whereClause}`
            );
            return ok({ created: indexName, tableName, schema });
          }

          if (operation === "drop") {
            if (!indexName) return fail("indexName is required for drop");
            const concurrentClause = concurrent ? "CONCURRENTLY " : "";
            const ife = ifExists ? "IF EXISTS " : "";
            const cascadeClause = cascade ? " CASCADE" : "";
            await client.query(
              `DROP INDEX ${concurrentClause}${ife}"${schema}"."${indexName}"${cascadeClause}`
            );
            return ok({ dropped: indexName, schema });
          }

          if (operation === "reindex") {
            if (!target || !type)
              return fail("target and type are required for reindex");
            const concurrentClause = concurrent ? "CONCURRENTLY " : "";
            if (type === "index")
              await client.query(
                `REINDEX INDEX ${concurrentClause}"${schema}"."${target}"`
              );
            else if (type === "table")
              await client.query(
                `REINDEX TABLE ${concurrentClause}"${schema}"."${target}"`
              );
            else if (type === "schema")
              await client.query(
                `REINDEX SCHEMA ${concurrentClause}"${schema}"`
              );
            else if (type === "database")
              await client.query(
                `REINDEX DATABASE ${concurrentClause}CURRENT_DATABASE()`
              );
            return ok({ reindexed: target, type });
          }

          if (operation === "analyze_usage") {
            const params: unknown[] = [schema, minSizeBytes];
            let sql = `SELECT psi.schemaname, psi.tablename, psi.indexname,
                         psi.idx_scan AS scans,
                         pg_relation_size(psi.indexrelname::regclass) AS size_bytes,
                         pg_size_pretty(pg_relation_size(psi.indexrelname::regclass)) AS size_pretty,
                         pi.indisunique AS is_unique, pi.indisprimary AS is_primary
                       FROM pg_stat_user_indexes psi
                       JOIN pg_index pi ON psi.indexrelid = pi.indexrelid
                       WHERE psi.schemaname = $1
                         AND pg_relation_size(psi.indexrelname::regclass) >= $2`;
            if (tableName) {
              sql += ` AND psi.tablename = $3`;
              params.push(tableName);
            }
            if (showUnused) sql += ` AND psi.idx_scan = 0`;
            sql += ` ORDER BY size_bytes DESC`;
            const res = await client.query(sql, params);
            return ok({ unusedIndexes: res.rows });
          }

          return fail(`Unknown operation: ${operation}`);
        } finally {
          client.release();
        }
      }
    );
  }

  // -------------------------------------------------------------------------
  // pg_manage_constraints
  // -------------------------------------------------------------------------
  if (enabled("pg_manage_constraints")) {
    server.tool(
      "pg_manage_constraints",
      "Manage PostgreSQL constraints - get, create foreign keys, drop constraints.",
      {
        operation: z
          .enum(["get", "create_fk", "drop_fk", "create", "drop"])
          .describe("Operation to perform"),
        schema: z.string().optional().default("public").describe("Schema name"),
        tableName: z.string().optional().describe("Table name"),
        constraintName: z.string().optional().describe("Constraint name"),
        columnNames: z
          .array(z.string())
          .optional()
          .describe("Column names for FK"),
        referencedTable: z
          .string()
          .optional()
          .describe("Referenced table for FK"),
        referencedColumns: z
          .array(z.string())
          .optional()
          .describe("Referenced columns for FK"),
        onDelete: z.string().optional().describe("ON DELETE action"),
        onUpdate: z.string().optional().describe("ON UPDATE action"),
        deferrable: z
          .boolean()
          .optional()
          .default(false)
          .describe("Deferrable constraint"),
        definition: z
          .string()
          .optional()
          .describe("Constraint definition SQL for create"),
        ifExists: z
          .boolean()
          .optional()
          .default(true)
          .describe("IF EXISTS for drop"),
        cascade: z
          .boolean()
          .optional()
          .default(false)
          .describe("CASCADE for drop")
      },
      async ({
        operation,
        schema = "public",
        tableName,
        constraintName,
        columnNames,
        referencedTable,
        referencedColumns,
        onDelete,
        onUpdate,
        deferrable = false,
        definition,
        ifExists = true,
        cascade = false
      }) => {
        const client = await pool.connect();
        try {
          if (operation === "get") {
            const params: unknown[] = [schema];
            let sql = `SELECT tc.table_name, tc.constraint_name, tc.constraint_type,
                         kcu.column_name,
                         ccu.table_name AS foreign_table_name,
                         ccu.column_name AS foreign_column_name,
                         rc.update_rule, rc.delete_rule
                       FROM information_schema.table_constraints tc
                       LEFT JOIN information_schema.key_column_usage kcu
                         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
                       LEFT JOIN information_schema.constraint_column_usage ccu
                         ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
                       LEFT JOIN information_schema.referential_constraints rc
                         ON tc.constraint_name = rc.constraint_name AND tc.constraint_schema = rc.constraint_schema
                       WHERE tc.table_schema = $1`;
            if (tableName) {
              sql += ` AND tc.table_name = $2`;
              params.push(tableName);
            }
            sql += ` ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name`;
            const res = await client.query(sql, params);
            return ok(res.rows);
          }

          if (operation === "create_fk" || operation === "create") {
            if (!tableName || !constraintName)
              return fail("tableName and constraintName are required");
            let sql: string;
            if (operation === "create_fk") {
              if (
                !columnNames?.length ||
                !referencedTable ||
                !referencedColumns?.length
              ) {
                return fail(
                  "columnNames, referencedTable, and referencedColumns are required for create_fk"
                );
              }
              const cols = columnNames.map((c) => `"${c}"`).join(", ");
              const refCols = referencedColumns.map((c) => `"${c}"`).join(", ");
              sql = `ALTER TABLE "${schema}"."${tableName}" ADD CONSTRAINT "${constraintName}" FOREIGN KEY (${cols}) REFERENCES "${schema}"."${referencedTable}" (${refCols})`;
              if (onDelete) sql += ` ON DELETE ${onDelete}`;
              if (onUpdate) sql += ` ON UPDATE ${onUpdate}`;
              if (deferrable) sql += ` DEFERRABLE`;
            } else {
              if (!definition) return fail("definition is required for create");
              sql = `ALTER TABLE "${schema}"."${tableName}" ADD CONSTRAINT "${constraintName}" ${definition}`;
            }
            await client.query(sql);
            return ok({ created: constraintName, tableName, schema });
          }

          if (operation === "drop_fk" || operation === "drop") {
            if (!tableName || !constraintName)
              return fail("tableName and constraintName are required");
            const ife = ifExists ? "IF EXISTS " : "";
            const cascadeClause = cascade ? " CASCADE" : "";
            await client.query(
              `ALTER TABLE "${schema}"."${tableName}" DROP CONSTRAINT ${ife}"${constraintName}"${cascadeClause}`
            );
            return ok({ dropped: constraintName, tableName, schema });
          }

          return fail(`Unknown operation: ${operation}`);
        } finally {
          client.release();
        }
      }
    );
  }

  // -------------------------------------------------------------------------
  // pg_manage_functions
  // -------------------------------------------------------------------------
  if (enabled("pg_manage_functions")) {
    server.tool(
      "pg_manage_functions",
      "Manage PostgreSQL functions - get, create, or drop functions.",
      {
        operation: z
          .enum(["get", "create", "drop"])
          .describe("Operation to perform"),
        schema: z.string().optional().default("public").describe("Schema name"),
        functionName: z
          .string()
          .optional()
          .describe("Function name (filter or target)"),
        parameters: z
          .string()
          .optional()
          .default("")
          .describe("Function parameter types (e.g. 'INT, TEXT')"),
        returnType: z.string().optional().describe("Return type for create"),
        functionBody: z
          .string()
          .optional()
          .describe("Function body for create"),
        language: z
          .enum(["sql", "plpgsql", "plpython3u"])
          .optional()
          .default("plpgsql")
          .describe("Language"),
        volatility: z
          .enum(["VOLATILE", "STABLE", "IMMUTABLE"])
          .optional()
          .default("VOLATILE")
          .describe("Volatility"),
        security: z
          .enum(["INVOKER", "DEFINER"])
          .optional()
          .default("INVOKER")
          .describe("Security context"),
        replace: z
          .boolean()
          .optional()
          .default(true)
          .describe("Use CREATE OR REPLACE"),
        ifExists: z
          .boolean()
          .optional()
          .default(true)
          .describe("IF EXISTS for drop"),
        cascade: z
          .boolean()
          .optional()
          .default(false)
          .describe("CASCADE for drop")
      },
      async ({
        operation,
        schema = "public",
        functionName,
        parameters = "",
        returnType,
        functionBody,
        language = "plpgsql",
        volatility = "VOLATILE",
        security = "INVOKER",
        replace = true,
        ifExists = true,
        cascade = false
      }) => {
        const client = await pool.connect();
        try {
          if (operation === "get") {
            const params: unknown[] = [schema];
            let sql = `SELECT routine_name AS function_name, routine_type, data_type AS return_type,
                         external_language AS language, security_type, routine_definition AS definition
                       FROM information_schema.routines
                       WHERE routine_schema = $1 AND routine_type IN ('FUNCTION', 'PROCEDURE')`;
            if (functionName) {
              sql += ` AND routine_name ILIKE $2`;
              params.push(functionName);
            }
            sql += ` ORDER BY routine_name`;
            const res = await client.query(sql, params);
            return ok(res.rows);
          }

          if (operation === "create") {
            if (!functionName || !returnType || !functionBody) {
              return fail(
                "functionName, returnType, and functionBody are required for create"
              );
            }
            const orReplace = replace ? "OR REPLACE " : "";
            const sql = `CREATE ${orReplace}FUNCTION "${schema}"."${functionName}"(${parameters})
RETURNS ${returnType}
LANGUAGE ${language}
${volatility}
SECURITY ${security}
AS $$${functionBody}$$`;
            await client.query(sql);
            return ok({ created: functionName, schema });
          }

          if (operation === "drop") {
            if (!functionName) return fail("functionName is required for drop");
            const ife = ifExists ? "IF EXISTS " : "";
            const cascadeClause = cascade ? " CASCADE" : "";
            const paramClause = parameters ? `(${parameters})` : "";
            await client.query(
              `DROP FUNCTION ${ife}"${schema}"."${functionName}"${paramClause}${cascadeClause}`
            );
            return ok({ dropped: functionName, schema });
          }

          return fail(`Unknown operation: ${operation}`);
        } finally {
          client.release();
        }
      }
    );
  }

  // -------------------------------------------------------------------------
  // pg_manage_triggers
  // -------------------------------------------------------------------------
  if (enabled("pg_manage_triggers")) {
    server.tool(
      "pg_manage_triggers",
      "Manage PostgreSQL triggers - get, create, drop, enable/disable.",
      {
        operation: z
          .enum(["get", "create", "drop", "set_state"])
          .describe("Operation to perform"),
        schema: z.string().optional().default("public").describe("Schema name"),
        tableName: z.string().optional().describe("Table name"),
        triggerName: z.string().optional().describe("Trigger name"),
        functionName: z
          .string()
          .optional()
          .describe("Trigger function name for create"),
        timing: z
          .enum(["BEFORE", "AFTER", "INSTEAD OF"])
          .optional()
          .describe("Trigger timing"),
        events: z
          .array(z.enum(["INSERT", "UPDATE", "DELETE", "TRUNCATE"]))
          .optional()
          .describe("Trigger events"),
        forEach: z
          .enum(["ROW", "STATEMENT"])
          .optional()
          .default("ROW")
          .describe("FOR EACH ROW or STATEMENT"),
        condition: z.string().optional().describe("WHEN condition"),
        ifExists: z
          .boolean()
          .optional()
          .default(true)
          .describe("IF EXISTS for drop"),
        cascade: z
          .boolean()
          .optional()
          .default(false)
          .describe("CASCADE for drop"),
        enable: z
          .boolean()
          .optional()
          .describe("true=enable, false=disable for set_state")
      },
      async ({
        operation,
        schema = "public",
        tableName,
        triggerName,
        functionName,
        timing,
        events,
        forEach = "ROW",
        condition,
        ifExists = true,
        cascade = false,
        enable
      }) => {
        const client = await pool.connect();
        try {
          if (operation === "get") {
            const params: unknown[] = [schema];
            let sql = `SELECT trigger_name, event_object_table AS table_name, event_manipulation AS event,
                         action_timing AS timing, action_orientation AS for_each,
                         action_statement AS definition, trigger_schema
                       FROM information_schema.triggers
                       WHERE trigger_schema = $1`;
            if (tableName) {
              sql += ` AND event_object_table = $2`;
              params.push(tableName);
            }
            sql += ` ORDER BY event_object_table, trigger_name`;
            const res = await client.query(sql, params);
            return ok(res.rows);
          }

          if (operation === "create") {
            if (
              !triggerName ||
              !tableName ||
              !functionName ||
              !timing ||
              !events?.length
            ) {
              return fail(
                "triggerName, tableName, functionName, timing, and events are required for create"
              );
            }
            const eventStr = events.join(" OR ");
            const conditionClause = condition ? ` WHEN (${condition})` : "";
            await client.query(
              `CREATE TRIGGER "${triggerName}" ${timing} ${eventStr} ON "${schema}"."${tableName}" FOR EACH ${forEach}${conditionClause} EXECUTE FUNCTION "${schema}"."${functionName}"()`
            );
            return ok({ created: triggerName, tableName, schema });
          }

          if (operation === "drop") {
            if (!triggerName || !tableName)
              return fail("triggerName and tableName are required for drop");
            const ife = ifExists ? "IF EXISTS " : "";
            const cascadeClause = cascade ? " CASCADE" : "";
            await client.query(
              `DROP TRIGGER ${ife}"${triggerName}" ON "${schema}"."${tableName}"${cascadeClause}`
            );
            return ok({ dropped: triggerName, tableName, schema });
          }

          if (operation === "set_state") {
            if (!triggerName || !tableName || enable === undefined) {
              return fail(
                "triggerName, tableName, and enable are required for set_state"
              );
            }
            const action = enable ? "ENABLE" : "DISABLE";
            await client.query(
              `ALTER TABLE "${schema}"."${tableName}" ${action} TRIGGER "${triggerName}"`
            );
            return ok({ triggerName, tableName, enabled: enable });
          }

          return fail(`Unknown operation: ${operation}`);
        } finally {
          client.release();
        }
      }
    );
  }

  // -------------------------------------------------------------------------
  // pg_manage_rls
  // -------------------------------------------------------------------------
  if (enabled("pg_manage_rls")) {
    server.tool(
      "pg_manage_rls",
      "Manage PostgreSQL Row-Level Security - enable/disable RLS and manage policies.",
      {
        operation: z
          .enum([
            "get_policies",
            "enable",
            "disable",
            "create_policy",
            "edit_policy",
            "drop_policy"
          ])
          .describe("Operation"),
        schema: z.string().optional().default("public").describe("Schema name"),
        tableName: z.string().optional().describe("Table name"),
        policyName: z.string().optional().describe("Policy name"),
        command: z
          .enum(["ALL", "SELECT", "INSERT", "UPDATE", "DELETE"])
          .optional()
          .default("ALL")
          .describe("Policy command"),
        roles: z
          .array(z.string())
          .optional()
          .describe("Roles the policy applies to"),
        using: z.string().optional().describe("USING expression"),
        check: z.string().optional().describe("WITH CHECK expression"),
        ifExists: z
          .boolean()
          .optional()
          .default(true)
          .describe("IF EXISTS for drop_policy")
      },
      async ({
        operation,
        schema = "public",
        tableName,
        policyName,
        command = "ALL",
        roles,
        using,
        check,
        ifExists = true
      }) => {
        const client = await pool.connect();
        try {
          if (operation === "get_policies") {
            const params: unknown[] = [schema];
            let sql = `SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
                       FROM pg_policies WHERE schemaname = $1`;
            if (tableName) {
              sql += ` AND tablename = $2`;
              params.push(tableName);
            }
            sql += ` ORDER BY tablename, policyname`;
            const res = await client.query(sql, params);
            return ok(res.rows);
          }

          if (operation === "enable") {
            if (!tableName) return fail("tableName is required for enable");
            await client.query(
              `ALTER TABLE "${schema}"."${tableName}" ENABLE ROW LEVEL SECURITY`
            );
            return ok({ enabled: true, tableName, schema });
          }

          if (operation === "disable") {
            if (!tableName) return fail("tableName is required for disable");
            await client.query(
              `ALTER TABLE "${schema}"."${tableName}" DISABLE ROW LEVEL SECURITY`
            );
            return ok({ enabled: false, tableName, schema });
          }

          if (operation === "create_policy" || operation === "edit_policy") {
            if (!tableName || !policyName)
              return fail("tableName and policyName are required");
            const rolesClause = roles?.length ? ` TO ${roles.join(", ")}` : "";
            const usingClause = using ? ` USING (${using})` : "";
            const checkClause = check ? ` WITH CHECK (${check})` : "";
            if (operation === "edit_policy") {
              await client.query(
                `ALTER POLICY "${policyName}" ON "${schema}"."${tableName}"${rolesClause}${usingClause}${checkClause}`
              );
            } else {
              await client.query(
                `CREATE POLICY "${policyName}" ON "${schema}"."${tableName}" FOR ${command}${rolesClause}${usingClause}${checkClause}`
              );
            }
            return ok({
              [operation === "edit_policy" ? "altered" : "created"]: policyName,
              tableName,
              schema
            });
          }

          if (operation === "drop_policy") {
            if (!tableName || !policyName)
              return fail(
                "tableName and policyName are required for drop_policy"
              );
            const ife = ifExists ? "IF EXISTS " : "";
            await client.query(
              `DROP POLICY ${ife}"${policyName}" ON "${schema}"."${tableName}"`
            );
            return ok({ dropped: policyName, tableName, schema });
          }

          return fail(`Unknown operation: ${operation}`);
        } finally {
          client.release();
        }
      }
    );
  }

  // -------------------------------------------------------------------------
  // pg_manage_query
  // -------------------------------------------------------------------------
  if (enabled("pg_manage_query")) {
    server.tool(
      "pg_manage_query",
      "Manage PostgreSQL query analysis and performance - EXPLAIN plans, slow queries, statistics.",
      {
        operation: z
          .enum(["explain", "get_slow_queries", "get_stats", "reset_stats"])
          .describe("Operation"),
        query: z
          .string()
          .optional()
          .describe("SQL query to explain (required for explain)"),
        analyze: z
          .boolean()
          .optional()
          .default(false)
          .describe("Use EXPLAIN ANALYZE (executes the query)"),
        format: z
          .enum(["text", "json", "xml", "yaml"])
          .optional()
          .default("json")
          .describe("EXPLAIN output format"),
        buffers: z
          .boolean()
          .optional()
          .default(false)
          .describe("Include buffer usage in EXPLAIN ANALYZE"),
        limit: z
          .number()
          .optional()
          .default(10)
          .describe("Number of results to return"),
        minDuration: z
          .number()
          .optional()
          .describe("Min average duration in ms for slow queries"),
        orderBy: z
          .enum(["mean_exec_time", "total_exec_time", "calls"])
          .optional()
          .default("mean_exec_time")
          .describe("Sort order"),
        queryPattern: z
          .string()
          .optional()
          .describe("Filter queries containing this pattern"),
        minCalls: z.number().optional().describe("Minimum number of calls"),
        queryId: z
          .string()
          .optional()
          .describe("Specific query ID to reset (for reset_stats)")
      },
      async ({
        operation,
        query,
        analyze = false,
        format = "json",
        buffers = false,
        limit = 10,
        minDuration,
        orderBy = "mean_exec_time",
        queryPattern,
        minCalls,
        queryId
      }) => {
        const client = await pool.connect();
        try {
          if (operation === "explain") {
            if (!query) return fail("query is required for explain");
            const opts: string[] = [`FORMAT ${format.toUpperCase()}`];
            if (analyze) opts.push("ANALYZE TRUE");
            if (buffers && analyze) opts.push("BUFFERS TRUE");
            const res = await client.query(
              `EXPLAIN (${opts.join(", ")}) ${query}`
            );
            return ok(res.rows);
          }

          if (operation === "get_slow_queries") {
            const params: unknown[] = [];
            let sql = `SELECT query, calls, mean_exec_time, total_exec_time, rows,
                         shared_blks_hit, shared_blks_read,
                         CASE WHEN shared_blks_hit + shared_blks_read = 0 THEN 0
                              ELSE round((shared_blks_hit::numeric / (shared_blks_hit + shared_blks_read)) * 100, 2)
                         END AS cache_hit_pct
                       FROM pg_stat_statements
                       WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())`;
            if (minDuration !== undefined) {
              params.push(minDuration);
              sql += ` AND mean_exec_time >= $${params.length}`;
            }
            params.push(limit);
            sql += ` ORDER BY ${orderBy} DESC LIMIT $${params.length}`;
            const res = await client.query(sql, params);
            return ok(res.rows);
          }

          if (operation === "get_stats") {
            const params: unknown[] = [];
            let sql = `SELECT query, calls, mean_exec_time, total_exec_time, rows,
                         shared_blks_hit, shared_blks_read,
                         CASE WHEN shared_blks_hit + shared_blks_read = 0 THEN 0
                              ELSE round((shared_blks_hit::numeric / (shared_blks_hit + shared_blks_read)) * 100, 2)
                         END AS cache_hit_pct
                       FROM pg_stat_statements
                       WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())`;
            if (queryPattern) {
              params.push(`%${queryPattern}%`);
              sql += ` AND query ILIKE $${params.length}`;
            }
            if (minCalls !== undefined) {
              params.push(minCalls);
              sql += ` AND calls >= $${params.length}`;
            }
            sql += ` ORDER BY ${orderBy} DESC`;
            const res = await client.query(sql, params);
            return ok(res.rows);
          }

          if (operation === "reset_stats") {
            if (queryId) {
              await client.query(
                `SELECT pg_stat_statements_reset(0, 0, $1::bigint)`,
                [queryId]
              );
            } else {
              await client.query(`SELECT pg_stat_statements_reset()`);
            }
            return ok({ reset: true, queryId: queryId ?? "all" });
          }

          return fail(`Unknown operation: ${operation}`);
        } finally {
          client.release();
        }
      }
    );
  }

  // -------------------------------------------------------------------------
  // pg_manage_users
  // -------------------------------------------------------------------------
  if (enabled("pg_manage_users")) {
    server.tool(
      "pg_manage_users",
      "Manage PostgreSQL users and permissions - get permissions, create/drop/alter users, grant/revoke.",
      {
        operation: z
          .enum([
            "get_permissions",
            "list",
            "create",
            "drop",
            "alter",
            "grant",
            "revoke"
          ])
          .describe("Operation"),
        username: z.string().optional().describe("Target username"),
        password: z.string().optional().describe("Password for create/alter"),
        superuser: z.boolean().optional().describe("Superuser privilege"),
        createdb: z.boolean().optional().describe("CREATEDB privilege"),
        createrole: z.boolean().optional().describe("CREATEROLE privilege"),
        login: z.boolean().optional().describe("LOGIN privilege"),
        replication: z.boolean().optional().describe("REPLICATION privilege"),
        connectionLimit: z.number().optional().describe("Connection limit"),
        permissions: z
          .array(
            z.enum([
              "SELECT",
              "INSERT",
              "UPDATE",
              "DELETE",
              "TRUNCATE",
              "REFERENCES",
              "TRIGGER",
              "ALL"
            ])
          )
          .optional()
          .describe("Permissions to grant/revoke"),
        targetObject: z
          .string()
          .optional()
          .describe("Target table/schema/database for grant/revoke"),
        targetType: z
          .enum(["table", "schema", "database", "sequence", "function"])
          .optional()
          .describe("Target type"),
        cascade: z
          .boolean()
          .optional()
          .default(false)
          .describe("CASCADE for drop")
      },
      async ({
        operation,
        username,
        password,
        superuser,
        createdb,
        createrole,
        login,
        replication,
        connectionLimit,
        permissions,
        targetObject,
        targetType,
        cascade = false
      }) => {
        const client = await pool.connect();
        try {
          if (operation === "get_permissions") {
            const res = await client.query(
              `SELECT grantee, table_schema, table_name, privilege_type, is_grantable
               FROM information_schema.table_privileges
               WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
               ${username ? "AND grantee = $1" : ""}
               ORDER BY grantee, table_schema, table_name, privilege_type`,
              username ? [username] : []
            );
            return ok(res.rows);
          }

          if (operation === "list") {
            const res = await client.query(
              `SELECT rolname AS username, rolsuper AS superuser, rolcreatedb AS createdb,
                 rolcreaterole AS createrole, rolcanlogin AS can_login,
                 rolreplication AS replication, rolconnlimit AS connection_limit
               FROM pg_roles ORDER BY rolname`
            );
            return ok(res.rows);
          }

          if (operation === "create") {
            if (!username) return fail("username is required for create");
            const parts: string[] = [];
            if (password)
              parts.push(`PASSWORD '${password.replace(/'/g, "''")}'`);
            if (superuser !== undefined)
              parts.push(superuser ? "SUPERUSER" : "NOSUPERUSER");
            if (createdb !== undefined)
              parts.push(createdb ? "CREATEDB" : "NOCREATEDB");
            if (createrole !== undefined)
              parts.push(createrole ? "CREATEROLE" : "NOCREATEROLE");
            if (login !== undefined) parts.push(login ? "LOGIN" : "NOLOGIN");
            if (replication !== undefined)
              parts.push(replication ? "REPLICATION" : "NOREPLICATION");
            if (connectionLimit !== undefined)
              parts.push(`CONNECTION LIMIT ${connectionLimit}`);
            await client.query(`CREATE USER "${username}" ${parts.join(" ")}`);
            return ok({ created: username });
          }

          if (operation === "drop") {
            if (!username) return fail("username is required for drop");
            const cascadeClause = cascade ? " CASCADE" : "";
            await client.query(`DROP USER "${username}"${cascadeClause}`);
            return ok({ dropped: username });
          }

          if (operation === "alter") {
            if (!username) return fail("username is required for alter");
            const parts: string[] = [];
            if (password)
              parts.push(`PASSWORD '${password.replace(/'/g, "''")}'`);
            if (superuser !== undefined)
              parts.push(superuser ? "SUPERUSER" : "NOSUPERUSER");
            if (createdb !== undefined)
              parts.push(createdb ? "CREATEDB" : "NOCREATEDB");
            if (createrole !== undefined)
              parts.push(createrole ? "CREATEROLE" : "NOCREATEROLE");
            if (login !== undefined) parts.push(login ? "LOGIN" : "NOLOGIN");
            if (replication !== undefined)
              parts.push(replication ? "REPLICATION" : "NOREPLICATION");
            if (connectionLimit !== undefined)
              parts.push(`CONNECTION LIMIT ${connectionLimit}`);
            if (!parts.length) return fail("No attributes specified for alter");
            await client.query(`ALTER USER "${username}" ${parts.join(" ")}`);
            return ok({ altered: username });
          }

          if (operation === "grant" || operation === "revoke") {
            if (
              !username ||
              !permissions?.length ||
              !targetObject ||
              !targetType
            ) {
              return fail(
                "username, permissions, targetObject, and targetType are required"
              );
            }
            const permStr = permissions.join(", ");
            const verb = operation === "grant" ? "GRANT" : "REVOKE";
            const toFrom = operation === "grant" ? "TO" : "FROM";
            let target = "";
            if (targetType === "table") target = `TABLE "${targetObject}"`;
            else if (targetType === "schema")
              target = `SCHEMA "${targetObject}"`;
            else if (targetType === "database")
              target = `DATABASE "${targetObject}"`;
            else if (targetType === "sequence")
              target = `SEQUENCE "${targetObject}"`;
            else if (targetType === "function")
              target = `FUNCTION ${targetObject}`;
            await client.query(
              `${verb} ${permStr} ON ${target} ${toFrom} "${username}"`
            );
            return ok({ [operation]: permissions, targetObject, username });
          }

          return fail(`Unknown operation: ${operation}`);
        } finally {
          client.release();
        }
      }
    );
  }

  // -------------------------------------------------------------------------
  // pg_analyze_database
  // -------------------------------------------------------------------------
  if (enabled("pg_analyze_database")) {
    server.tool(
      "pg_analyze_database",
      "Analyze PostgreSQL database performance and configuration.",
      {
        analysisType: z
          .enum(["performance", "configuration", "storage", "all"])
          .optional()
          .default("all")
          .describe("Type of analysis")
      },
      async ({ analysisType = "all" }) => {
        const client = await pool.connect();
        try {
          const result: Record<string, unknown> = {};

          if (analysisType === "all" || analysisType === "performance") {
            const cacheRes = await client.query(
              `SELECT sum(heap_blks_hit) AS heap_hit, sum(heap_blks_read) AS heap_read,
                 CASE WHEN sum(heap_blks_hit) + sum(heap_blks_read) = 0 THEN 0
                      ELSE round(sum(heap_blks_hit)::numeric / (sum(heap_blks_hit) + sum(heap_blks_read)) * 100, 2)
                 END AS cache_hit_pct
               FROM pg_statio_user_tables`
            );
            result.cacheHitRatio = cacheRes.rows[0];
          }

          if (analysisType === "all" || analysisType === "configuration") {
            const versionRes = await client.query(`SELECT version()`);
            const settingsRes = await client.query(
              `SELECT name, setting, unit, category FROM pg_settings
               WHERE name IN ('max_connections','shared_buffers','effective_cache_size','work_mem',
                 'maintenance_work_mem','checkpoint_completion_target','wal_buffers',
                 'default_statistics_target','random_page_cost','effective_io_concurrency')
               ORDER BY category, name`
            );
            result.version = versionRes.rows[0].version;
            result.keySettings = settingsRes.rows;
          }

          if (analysisType === "all" || analysisType === "storage") {
            const sizeRes = await client.query(
              `SELECT table_schema AS schema, table_name,
                 pg_size_pretty(pg_total_relation_size(quote_ident(table_schema) || '.' || quote_ident(table_name))) AS total_size,
                 pg_total_relation_size(quote_ident(table_schema) || '.' || quote_ident(table_name)) AS size_bytes
               FROM information_schema.tables
               WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
               ORDER BY size_bytes DESC LIMIT 20`
            );
            result.largestTables = sizeRes.rows;
          }

          return ok(result);
        } finally {
          client.release();
        }
      }
    );
  }

  // -------------------------------------------------------------------------
  // pg_monitor_database
  // -------------------------------------------------------------------------
  if (enabled("pg_monitor_database")) {
    server.tool(
      "pg_monitor_database",
      "Get real-time monitoring information for a PostgreSQL database.",
      {
        includeTables: z
          .boolean()
          .optional()
          .default(false)
          .describe("Include table statistics"),
        includeQueries: z
          .boolean()
          .optional()
          .default(false)
          .describe("Include active query info"),
        includeLocks: z
          .boolean()
          .optional()
          .default(false)
          .describe("Include lock information"),
        includeReplication: z
          .boolean()
          .optional()
          .default(false)
          .describe("Include replication lag info")
      },
      async ({
        includeTables = false,
        includeQueries = false,
        includeLocks = false,
        includeReplication = false
      }) => {
        const client = await pool.connect();
        try {
          const result: Record<string, unknown> = {};

          const connRes = await client.query(
            `SELECT state, count(*) AS count FROM pg_stat_activity GROUP BY state ORDER BY count DESC`
          );
          result.connections = connRes.rows;

          const dbRes = await client.query(
            `SELECT datname AS database, numbackends AS connections, xact_commit AS commits,
               xact_rollback AS rollbacks, blks_read, blks_hit,
               CASE WHEN blks_read + blks_hit = 0 THEN 0
                    ELSE round(blks_hit::numeric / (blks_read + blks_hit) * 100, 2)
               END AS cache_hit_pct
             FROM pg_stat_database WHERE datname = current_database()`
          );
          result.database = dbRes.rows[0];

          if (includeTables) {
            const tableRes = await client.query(
              `SELECT schemaname, relname AS table_name, seq_scan, idx_scan,
                 n_tup_ins AS inserts, n_tup_upd AS updates, n_tup_del AS deletes,
                 n_live_tup AS live_rows, n_dead_tup AS dead_rows,
                 last_vacuum, last_autovacuum, last_analyze, last_autoanalyze
               FROM pg_stat_user_tables ORDER BY seq_scan + idx_scan DESC LIMIT 20`
            );
            result.tables = tableRes.rows;
          }

          if (includeQueries) {
            const queryRes = await client.query(
              `SELECT pid, state, wait_event_type, wait_event, query_start,
                 round(extract(epoch FROM now() - query_start)::numeric, 2) AS duration_sec,
                 left(query, 200) AS query
               FROM pg_stat_activity
               WHERE state != 'idle' AND pid != pg_backend_pid()
               ORDER BY query_start`
            );
            result.activeQueries = queryRes.rows;
          }

          if (includeLocks) {
            const lockRes = await client.query(
              `SELECT l.pid, l.mode, l.granted, c.relname AS table_name,
                 a.query_start, left(a.query, 100) AS query
               FROM pg_locks l
               LEFT JOIN pg_class c ON l.relation = c.oid
               LEFT JOIN pg_stat_activity a ON l.pid = a.pid
               WHERE NOT l.granted ORDER BY a.query_start`
            );
            result.waitingLocks = lockRes.rows;
          }

          if (includeReplication) {
            const replRes = await client.query(
              `SELECT application_name, state, sync_state,
                 write_lag, flush_lag, replay_lag,
                 pg_size_pretty(sent_lsn - write_lsn) AS write_lag_bytes,
                 pg_size_pretty(sent_lsn - flush_lsn) AS flush_lag_bytes,
                 pg_size_pretty(sent_lsn - replay_lsn) AS replay_lag_bytes
               FROM pg_stat_replication`
            );
            result.replication = replRes.rows;
          }

          return ok(result);
        } finally {
          client.release();
        }
      }
    );
  }

  // -------------------------------------------------------------------------
  // pg_debug_database
  // -------------------------------------------------------------------------
  if (enabled("pg_debug_database")) {
    server.tool(
      "pg_debug_database",
      "Diagnose common PostgreSQL issues - connections, locks, performance, replication.",
      {
        issue: z
          .enum(["connection", "performance", "locks", "replication", "all"])
          .optional()
          .default("all")
          .describe("Issue type to diagnose")
      },
      async ({ issue = "all" }) => {
        const client = await pool.connect();
        try {
          const result: Record<string, unknown> = {};

          if (issue === "all" || issue === "connection") {
            const connRes = await client.query(
              `SELECT max_conn, used_conn, reserved_conn, max_conn - used_conn - reserved_conn AS available_conn
               FROM (
                 SELECT (SELECT setting::int FROM pg_settings WHERE name='max_connections') AS max_conn,
                        (SELECT count(*) FROM pg_stat_activity) AS used_conn,
                        (SELECT setting::int FROM pg_settings WHERE name='superuser_reserved_connections') AS reserved_conn
               ) t`
            );
            result.connections = connRes.rows[0];
          }

          if (issue === "all" || issue === "performance") {
            const perfRes = await client.query(
              `SELECT sum(heap_blks_hit) AS heap_hit, sum(heap_blks_read) AS heap_read,
                 CASE WHEN sum(heap_blks_hit) + sum(heap_blks_read) = 0 THEN 0
                      ELSE round(sum(heap_blks_hit)::numeric / (sum(heap_blks_hit) + sum(heap_blks_read)) * 100, 2)
                 END AS cache_hit_pct
               FROM pg_statio_user_tables`
            );
            const seqRes = await client.query(
              `SELECT schemaname, relname AS table_name, seq_scan,
                 pg_size_pretty(pg_relation_size(schemaname || '.' || relname)) AS size
               FROM pg_stat_user_tables WHERE seq_scan > 100 ORDER BY seq_scan DESC LIMIT 10`
            );
            result.cacheStats = perfRes.rows[0];
            result.highSeqScanTables = seqRes.rows;
          }

          if (issue === "all" || issue === "locks") {
            const lockRes = await client.query(
              `SELECT blocked.pid AS blocked_pid, blocked.query AS blocked_query,
                 blocking.pid AS blocking_pid, blocking.query AS blocking_query,
                 now() - blocked.query_start AS blocked_duration
               FROM pg_stat_activity blocked
               JOIN pg_stat_activity blocking ON blocking.pid = ANY(pg_blocking_pids(blocked.pid))
               WHERE cardinality(pg_blocking_pids(blocked.pid)) > 0`
            );
            result.blockedQueries = lockRes.rows;
          }

          if (issue === "all" || issue === "replication") {
            const replRes = await client.query(
              `SELECT pg_is_in_recovery() AS is_replica,
                 CASE WHEN pg_is_in_recovery() THEN
                   round(extract(epoch FROM now() - pg_last_xact_replay_timestamp())::numeric, 2)
                 ELSE NULL END AS replication_lag_sec`
            );
            result.replication = replRes.rows[0];
          }

          return ok(result);
        } finally {
          client.release();
        }
      }
    );
  }

  // -------------------------------------------------------------------------
  // pg_get_setup_instructions
  // -------------------------------------------------------------------------
  if (enabled("pg_get_setup_instructions")) {
    server.tool(
      "pg_get_setup_instructions",
      "Get platform-specific PostgreSQL setup and connection instructions.",
      {
        platform: z
          .enum(["macos", "linux", "windows", "docker", "cloud"])
          .optional()
          .default("linux")
          .describe("Target platform")
      },
      async ({ platform = "linux" }) => {
        const instructions: Record<string, string> = {
          macos:
            "Install PostgreSQL on macOS:\n  brew install postgresql\n  brew services start postgresql\n  createdb mydb\n\nConnect:\n  psql -d mydb",
          linux:
            "Install PostgreSQL on Linux:\n  sudo apt-get install postgresql postgresql-contrib\n  sudo systemctl start postgresql\n  sudo -u postgres createdb mydb\n\nConnect:\n  sudo -u postgres psql -d mydb",
          windows:
            "Install PostgreSQL on Windows:\n  Download installer from https://www.postgresql.org/download/windows/\n  Run the installer and follow the wizard.\n\nConnect:\n  psql -U postgres -d mydb",
          docker:
            "Run PostgreSQL in Docker:\n  docker run --name pg -e POSTGRES_PASSWORD=secret -e POSTGRES_DB=mydb -p 5432:5432 -d postgres\n\nConnect:\n  docker exec -it pg psql -U postgres -d mydb",
          cloud:
            "Cloud PostgreSQL options:\n  - AWS RDS: https://aws.amazon.com/rds/postgresql/\n  - Google Cloud SQL: https://cloud.google.com/sql/docs/postgres\n  - Azure Database: https://azure.microsoft.com/en-us/products/postgresql\n  - Supabase: https://supabase.com\n  - Neon: https://neon.tech\n\nConnect using the connection string provided by your cloud provider."
        };
        return ok(instructions[platform] ?? instructions.linux);
      }
    );
  }

  // -------------------------------------------------------------------------
  // pg_execute_mutation  (opt-in write tool)
  // -------------------------------------------------------------------------
  if (enabled("pg_execute_mutation")) {
    server.tool(
      "pg_execute_mutation",
      "Execute data modification operations - INSERT, UPDATE, DELETE, or UPSERT. NOT enabled by default; must be opted-in via tool= arg.",
      {
        operation: z
          .enum(["insert", "update", "delete", "upsert"])
          .describe("Mutation operation"),
        table: z.string().describe("Target table name"),
        schema: z.string().optional().default("public").describe("Schema name"),
        data: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Data to insert/update (column -> value)"),
        where: z
          .string()
          .optional()
          .describe(
            "WHERE clause for update/delete (without the WHERE keyword)"
          ),
        conflictColumns: z
          .array(z.string())
          .optional()
          .describe("Columns for ON CONFLICT resolution in upsert"),
        returning: z
          .string()
          .optional()
          .describe('RETURNING clause (e.g. "*" or "id, name")')
      },
      async ({
        operation,
        table,
        schema = "public",
        data,
        where,
        conflictColumns,
        returning
      }) => {
        const client = await pool.connect();
        try {
          const returningClause = returning ? ` RETURNING ${returning}` : "";

          if (operation === "insert" || operation === "upsert") {
            if (!data || !Object.keys(data).length)
              return fail("data is required for insert/upsert");
            const cols = Object.keys(data);
            const vals = Object.values(data);
            const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
            const colNames = cols.map((c) => `"${c}"`).join(", ");
            let sql = `INSERT INTO "${schema}"."${table}" (${colNames}) VALUES (${placeholders})`;
            if (operation === "upsert") {
              if (!conflictColumns?.length)
                return fail("conflictColumns is required for upsert");
              const conflictCols = conflictColumns
                .map((c) => `"${c}"`)
                .join(", ");
              const updateClauses = cols
                .filter((c) => !conflictColumns.includes(c))
                .map((c, i) => `"${c}" = EXCLUDED."${c}"`)
                .join(", ");
              sql += ` ON CONFLICT (${conflictCols})`;
              sql += updateClauses
                ? ` DO UPDATE SET ${updateClauses}`
                : ` DO NOTHING`;
            }
            sql += returningClause;
            const res = await client.query(sql, vals);
            return ok({
              operation,
              rowsAffected: res.rowCount,
              returning: res.rows
            });
          }

          if (operation === "update") {
            if (!data || !Object.keys(data).length)
              return fail("data is required for update");
            if (!where) return fail("where is required for update");
            const cols = Object.keys(data);
            const vals = Object.values(data);
            const setClauses = cols
              .map((c, i) => `"${c}" = $${i + 1}`)
              .join(", ");
            const sql = `UPDATE "${schema}"."${table}" SET ${setClauses} WHERE ${where}${returningClause}`;
            const res = await client.query(sql, vals);
            return ok({
              operation,
              rowsAffected: res.rowCount,
              returning: res.rows
            });
          }

          if (operation === "delete") {
            if (!where) return fail("where is required for delete");
            const sql = `DELETE FROM "${schema}"."${table}" WHERE ${where}${returningClause}`;
            const res = await client.query(sql);
            return ok({
              operation,
              rowsAffected: res.rowCount,
              returning: res.rows
            });
          }

          return fail(`Unknown operation: ${operation}`);
        } finally {
          client.release();
        }
      }
    );
  }

  // -------------------------------------------------------------------------
  // pg_execute_sql  (opt-in arbitrary SQL tool)
  // -------------------------------------------------------------------------
  if (enabled("pg_execute_sql")) {
    server.tool(
      "pg_execute_sql",
      "Execute arbitrary SQL statements with optional transaction support. NOT enabled by default; must be opted-in via tool= arg.",
      {
        sql: z.string().describe("SQL statement to execute"),
        parameters: z
          .array(z.unknown())
          .optional()
          .default([])
          .describe("Prepared statement parameters ($1, $2, ...)"),
        expectRows: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            "Whether to return rows (false for DDL/DML without RETURNING)"
          ),
        timeout: z.number().optional().describe("Query timeout in ms"),
        transactional: z
          .boolean()
          .optional()
          .default(false)
          .describe("Wrap in a transaction (BEGIN/COMMIT, ROLLBACK on error)")
      },
      async ({
        sql: sqlText,
        parameters = [],
        expectRows = true,
        timeout,
        transactional = false
      }) => {
        const client = await pool.connect();
        try {
          if (timeout)
            await client.query(
              `SET LOCAL statement_timeout = ${Number(timeout)}`
            );
          if (transactional) await client.query("BEGIN");
          try {
            const res = await client.query(sqlText, parameters as unknown[]);
            if (transactional) await client.query("COMMIT");
            return ok({
              rowsAffected: res.rowCount,
              rows: expectRows ? res.rows : undefined
            });
          } catch (err) {
            if (transactional) await client.query("ROLLBACK");
            throw err;
          }
        } finally {
          client.release();
        }
      }
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
  const cwd = process.cwd();

  const envFileArg = process.argv
    .slice(2)
    .find((a) => a.startsWith("env-file="))
    ?.slice(9);

  const envPath = envFileArg ? resolve(cwd, envFileArg) : findEnvFile(cwd);

  if (!envPath) {
    process.stderr.write(
      `ERROR: .env file not found in ${cwd} or any parent directory\n`
    );
    process.stderr.write(
      `Tip: pass env-file=<relative-path> as an argument to point to the .env explicitly.\n`
    );
    process.exit(1);
  }

  let dotenv: Record<string, string>;
  try {
    dotenv = loadEnvFile(envPath);
  } catch (err) {
    process.stderr.write(`ERROR: ${(err as Error).message}\n`);
    process.exit(1);
  }

  const envVars = process.env as Record<string, string>;

  const host = resolveCredential(envVars, dotenv, "MCP_KEY_HOST", "DB_HOST");
  const port = resolveCredential(envVars, dotenv, "MCP_KEY_PORT", "DB_PORT");
  const name = resolveCredential(envVars, dotenv, "MCP_KEY_NAME", "DB_NAME");
  const sslmode = resolveCredential(
    envVars,
    dotenv,
    "MCP_KEY_SSLMODE",
    "DB_SSLMODE"
  );
  const user = resolveCredential(envVars, dotenv, "MCP_KEY_USER", "DB_USER");
  const pass = resolveCredential(envVars, dotenv, "MCP_KEY_PASS", "DB_PASS");

  const missing: string[] = [];
  if (!host) missing.push(envVars["MCP_KEY_HOST"] ?? "DB_HOST");
  if (!port) missing.push(envVars["MCP_KEY_PORT"] ?? "DB_PORT");
  if (!name) missing.push(envVars["MCP_KEY_NAME"] ?? "DB_NAME");
  if (!sslmode) missing.push(envVars["MCP_KEY_SSLMODE"] ?? "DB_SSLMODE");
  if (!user) missing.push(envVars["MCP_KEY_USER"] ?? "DB_USER");
  if (!pass) missing.push(envVars["MCP_KEY_PASS"] ?? "DB_PASS");

  if (missing.length > 0) {
    process.stderr.write(
      `ERROR: Missing keys in .env: ${missing.join(", ")}\n`
    );
    process.stderr.write(
      `Check the mapping in mcp.json (env field > MCP_KEY_*) and the .env file.\n`
    );
    process.exit(1);
  }

  const tools = process.argv
    .slice(2)
    .filter((a) => a.startsWith("tool="))
    .map((a) => a.slice(5));

  const enabledTools = tools.length > 0 ? tools : DEFAULT_READONLY_TOOLS;

  // Validate requested tools
  for (const tool of enabledTools) {
    if (!SUPPORTED_TOOLS.includes(tool)) {
      process.stderr.write(`ERROR: Unsupported tool: ${tool}\n`);
      process.stderr.write(`Supported tools: ${SUPPORTED_TOOLS.join(", ")}\n`);
      process.exit(1);
    }
  }

  // Write-capable tools require explicit opt-in via environment variable
  const hasWriteTool = enabledTools.some((tool) =>
    WRITE_CAPABLE_TOOLS.includes(tool)
  );
  if (hasWriteTool && process.env["POSTGRES_MCP_ALLOW_WRITE"] !== "true") {
    process.stderr.write(
      "ERROR: Write-capable tools require POSTGRES_MCP_ALLOW_WRITE=true in the environment.\n" +
        "Write-capable tools requested: " +
        enabledTools.filter((t) => WRITE_CAPABLE_TOOLS.includes(t)).join(", ") +
        "\n" +
        "Set POSTGRES_MCP_ALLOW_WRITE=true in the env section of your mcp.json to proceed.\n"
    );
    process.exit(1);
  }

  const connStr = buildConnectionString({
    host,
    port,
    name,
    sslmode,
    user,
    pass
  });

  process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

  const pool = new Pool({
    connectionString: connStr,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });

  const server = new McpServer(
    { name: "postgres-mcp", version: "1.0.0" },
    { instructions: MCP_INSTRUCTIONS }
  );

  registerTools(server, pool, enabledTools);

  const transport = new StdioServerTransport();
  server.connect(transport).catch((err: Error) => {
    process.stderr.write(
      `ERROR: Failed to connect MCP transport: ${err.message}\n`
    );
    process.exit(1);
  });
}

if (require.main === module) {
  main();
}
