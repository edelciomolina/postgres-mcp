import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Pool } from "pg";
import type { DatabaseGraph, TableNode } from "../semantic/graph-types.js";
import { buildDatabaseGraph } from "../semantic/graph-builder.js";
import { classifyQueryRisk } from "../semantic/risk-classifier.js";
import type { McpConfig } from "../config.js";

// ---------------------------------------------------------------------------
// Shared graph cache (per-process, rebuilt on demand)
// ---------------------------------------------------------------------------

let cachedGraph: DatabaseGraph | null = null;
let cacheBuiltAt: number | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getGraph(pool: Pool, config: McpConfig): Promise<DatabaseGraph> {
  const now = Date.now();
  if (cachedGraph && cacheBuiltAt && now - cacheBuiltAt < CACHE_TTL_MS) {
    return cachedGraph;
  }
  cachedGraph = await buildDatabaseGraph(pool, config);
  cacheBuiltAt = now;
  return cachedGraph;
}

/** Invalidate the in-memory graph cache (e.g. after schema changes). */
export function invalidateGraphCache(): void {
  cachedGraph = null;
  cacheBuiltAt = null;
}

// ---------------------------------------------------------------------------
// Helper
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
// Register semantic tools on the MCP server
// ---------------------------------------------------------------------------

export function registerSemanticTools(
  server: McpServer,
  pool: Pool,
  config: McpConfig,
  enabledTools: readonly string[]
): void {
  function enabled(name: string): boolean {
    return enabledTools.includes(name);
  }

  // -------------------------------------------------------------------------
  // pg_inspect_database_graph
  // -------------------------------------------------------------------------
  if (enabled("pg_inspect_database_graph")) {
    server.tool(
      "pg_inspect_database_graph",
      "Build and return a structural knowledge graph of the database: schemas, tables, columns, " +
        "foreign keys, indexes, inferred relations, and business domains. " +
        "Use this as a starting point before querying unfamiliar databases. " +
        "All inferred fields are clearly tagged - treat them as hints, not facts.",
      {
        schema: z
          .string()
          .optional()
          .describe(
            "Filter to a specific schema (default: all non-system schemas)"
          ),
        summarize: z
          .boolean()
          .optional()
          .default(false)
          .describe("Return a compact summary instead of the full graph"),
        refresh: z
          .boolean()
          .optional()
          .default(false)
          .describe("Force rebuild of the in-memory graph, ignoring cache")
      },
      async ({ schema, summarize = false, refresh = false }) => {
        if (refresh) invalidateGraphCache();
        let graph: DatabaseGraph;
        try {
          graph = await getGraph(pool, config);
        } catch (err) {
          return fail(
            `Failed to build database graph: ${(err as Error).message}`
          );
        }

        if (schema) {
          const filtered = {
            ...graph,
            tables: graph.tables.filter((t) => t.schema === schema),
            foreignKeys: graph.foreignKeys.filter(
              (fk) => fk.fromSchema === schema || fk.toSchema === schema
            ),
            inferredRelations: graph.inferredRelations.filter(
              (r) => r.fromSchema === schema || r.toSchema === schema
            ),
            indexes: graph.indexes.filter((i) => i.schema === schema)
          };
          return ok(summarize ? summarizeGraph(filtered) : filtered);
        }

        return ok(summarize ? summarizeGraph(graph) : graph);
      }
    );
  }

  // -------------------------------------------------------------------------
  // pg_describe_table_semantics
  // -------------------------------------------------------------------------
  if (enabled("pg_describe_table_semantics")) {
    server.tool(
      "pg_describe_table_semantics",
      "Describe a table with semantic context: probable purpose, risk level, column roles, " +
        "sensitive columns, related tables (via FK and inferred), and allowed operations. " +
        "Use this before writing any query against an unfamiliar table.",
      {
        schema: z
          .string()
          .optional()
          .default("public")
          .describe("Schema name (defaults to public)"),
        table: z.string().describe("Table name")
      },
      async ({ schema = "public", table }) => {
        let graph: DatabaseGraph;
        try {
          graph = await getGraph(pool, config);
        } catch (err) {
          return fail(
            `Failed to build database graph: ${(err as Error).message}`
          );
        }

        const node = graph.tables.find(
          (t) => t.schema === schema && t.name === table
        );
        if (!node) {
          return fail(
            `Table "${schema}.${table}" not found in the graph. ` +
              `Available tables in schema "${schema}": ` +
              graph.tables
                .filter((t) => t.schema === schema)
                .map((t) => t.name)
                .join(", ") || "(none)"
          );
        }

        // Collect FK relations involving this table
        const fkRelations = [
          ...graph.foreignKeys
            .filter((fk) => fk.fromTable === table && fk.fromSchema === schema)
            .map((fk) => ({
              direction: "references" as const,
              table: `${fk.toSchema}.${fk.toTable}`,
              via: `${fk.fromColumn} → ${fk.toColumn}`,
              type: "explicit_fk"
            })),
          ...graph.foreignKeys
            .filter((fk) => fk.toTable === table && fk.toSchema === schema)
            .map((fk) => ({
              direction: "referenced_by" as const,
              table: `${fk.fromSchema}.${fk.fromTable}`,
              via: `${fk.fromColumn} → ${fk.toColumn}`,
              type: "explicit_fk"
            }))
        ];

        const inferredRelations = [
          ...graph.inferredRelations
            .filter((r) => r.fromTable === table && r.fromSchema === schema)
            .map((r) => ({
              direction: "likely_references" as const,
              table: `${r.toSchema}.${r.toTable}`,
              via: r.fromColumn,
              confidence: r.confidence,
              reason: r.reason,
              type: "inferred"
            })),
          ...graph.inferredRelations
            .filter((r) => r.toTable === table && r.toSchema === schema)
            .map((r) => ({
              direction: "likely_referenced_by" as const,
              table: `${r.fromSchema}.${r.fromTable}`,
              via: r.fromColumn,
              confidence: r.confidence,
              reason: r.reason,
              type: "inferred"
            }))
        ];

        const sensitiveColumns = node.columns
          .filter((c) => c.isSensitive)
          .map((c) => c.name);

        const domain = graph.domains.find((d) =>
          d.tables.includes(`${schema}.${table}`)
        );

        return ok({
          schema,
          table,
          probableType: node.probableType,
          riskLevel: node.riskLevel,
          allowedOperations: node.allowedOperations,
          rowEstimate: node.rowEstimate,
          sensitiveColumns,
          columns: node.columns.map((c) => ({
            name: c.name,
            dataType: c.dataType,
            semanticRole: c.semanticRole,
            isSensitive: c.isSensitive,
            isNullable: c.isNullable
          })),
          relations: fkRelations,
          inferredRelations,
          domain: domain ? domain.name : null,
          _note:
            "probableType, riskLevel, semanticRole, and inferredRelations are inferred from naming patterns. " +
            "Verify against actual business context before acting on them."
        });
      }
    );
  }

  // -------------------------------------------------------------------------
  // pg_find_related_tables
  // -------------------------------------------------------------------------
  if (enabled("pg_find_related_tables")) {
    server.tool(
      "pg_find_related_tables",
      "Find tables related to a given table via explicit foreign keys and inferred naming patterns. " +
        "Useful for understanding join paths before writing multi-table queries.",
      {
        schema: z
          .string()
          .optional()
          .default("public")
          .describe("Schema of the starting table"),
        table: z.string().describe("Starting table name"),
        depth: z
          .number()
          .optional()
          .default(2)
          .describe("How many hops to traverse (1–3, default 2)"),
        includeInferred: z
          .boolean()
          .optional()
          .default(true)
          .describe("Include inferred (pattern-based) relationships")
      },
      async ({
        schema = "public",
        table,
        depth = 2,
        includeInferred = true
      }) => {
        let graph: DatabaseGraph;
        try {
          graph = await getGraph(pool, config);
        } catch (err) {
          return fail(
            `Failed to build database graph: ${(err as Error).message}`
          );
        }

        const start = graph.tables.find(
          (t) => t.schema === schema && t.name === table
        );
        if (!start) {
          return fail(`Table "${schema}.${table}" not found in the graph.`);
        }

        const clampedDepth = Math.min(Math.max(depth, 1), 3);
        const visited = new Set<string>([`${schema}.${table}`]);
        const related: Array<{
          table: string;
          riskLevel: string;
          probableType: string;
          relationshipType: string;
          path: string[];
          confidence?: string;
          reason?: string;
        }> = [];

        type QueueItem = { key: string; path: string[] };
        const queue: QueueItem[] = [
          { key: `${schema}.${table}`, path: [`${schema}.${table}`] }
        ];

        while (queue.length > 0) {
          const { key, path } = queue.shift()!;
          if (path.length > clampedDepth) continue;

          const [currentSchema, currentTable] = key.split(".");

          // Explicit FKs
          const outFKs = graph.foreignKeys.filter(
            (fk) =>
              fk.fromTable === currentTable && fk.fromSchema === currentSchema
          );
          const inFKs = graph.foreignKeys.filter(
            (fk) => fk.toTable === currentTable && fk.toSchema === currentSchema
          );

          for (const fk of outFKs) {
            const targetKey = `${fk.toSchema}.${fk.toTable}`;
            if (!visited.has(targetKey)) {
              visited.add(targetKey);
              const node = graph.tables.find(
                (t) => t.schema === fk.toSchema && t.name === fk.toTable
              );
              if (node) {
                const newPath = [
                  ...path,
                  `${fk.fromColumn}→${fk.toColumn}`,
                  targetKey
                ];
                related.push({
                  table: targetKey,
                  riskLevel: node.riskLevel,
                  probableType: node.probableType,
                  relationshipType: "explicit_fk (references)",
                  path: newPath
                });
                if (path.length < clampedDepth)
                  queue.push({ key: targetKey, path: newPath });
              }
            }
          }

          for (const fk of inFKs) {
            const sourceKey = `${fk.fromSchema}.${fk.fromTable}`;
            if (!visited.has(sourceKey)) {
              visited.add(sourceKey);
              const node = graph.tables.find(
                (t) => t.schema === fk.fromSchema && t.name === fk.fromTable
              );
              if (node) {
                const newPath = [
                  ...path,
                  `${fk.fromColumn}→${fk.toColumn}`,
                  sourceKey
                ];
                related.push({
                  table: sourceKey,
                  riskLevel: node.riskLevel,
                  probableType: node.probableType,
                  relationshipType: "explicit_fk (referenced_by)",
                  path: newPath
                });
                if (path.length < clampedDepth)
                  queue.push({ key: sourceKey, path: newPath });
              }
            }
          }

          // Inferred relations
          if (includeInferred) {
            const outInferred = graph.inferredRelations.filter(
              (r) =>
                r.fromTable === currentTable && r.fromSchema === currentSchema
            );
            const inInferred = graph.inferredRelations.filter(
              (r) => r.toTable === currentTable && r.toSchema === currentSchema
            );

            for (const r of outInferred) {
              const targetKey = `${r.toSchema}.${r.toTable}`;
              if (!visited.has(targetKey)) {
                visited.add(targetKey);
                const node = graph.tables.find(
                  (t) => t.schema === r.toSchema && t.name === r.toTable
                );
                if (node) {
                  const newPath = [
                    ...path,
                    `${r.fromColumn}(inferred)`,
                    targetKey
                  ];
                  related.push({
                    table: targetKey,
                    riskLevel: node.riskLevel,
                    probableType: node.probableType,
                    relationshipType: "inferred (likely_references)",
                    confidence: r.confidence,
                    reason: r.reason,
                    path: newPath
                  });
                  if (path.length < clampedDepth)
                    queue.push({ key: targetKey, path: newPath });
                }
              }
            }

            for (const r of inInferred) {
              const sourceKey = `${r.fromSchema}.${r.fromTable}`;
              if (!visited.has(sourceKey)) {
                visited.add(sourceKey);
                const node = graph.tables.find(
                  (t) => t.schema === r.fromSchema && t.name === r.fromTable
                );
                if (node) {
                  const newPath = [
                    ...path,
                    `${r.fromColumn}(inferred)`,
                    sourceKey
                  ];
                  related.push({
                    table: sourceKey,
                    riskLevel: node.riskLevel,
                    probableType: node.probableType,
                    relationshipType: "inferred (likely_referenced_by)",
                    confidence: r.confidence,
                    reason: r.reason,
                    path: newPath
                  });
                  if (path.length < clampedDepth)
                    queue.push({ key: sourceKey, path: newPath });
                }
              }
            }
          }
        }

        return ok({
          startTable: `${schema}.${table}`,
          depth: clampedDepth,
          relatedTables: related,
          _note:
            "Inferred relations are derived from naming patterns. " +
            "Explicit FK relations are from the database schema."
        });
      }
    );
  }

  // -------------------------------------------------------------------------
  // pg_classify_query_risk
  // -------------------------------------------------------------------------
  if (enabled("pg_classify_query_risk")) {
    server.tool(
      "pg_classify_query_risk",
      "Classify the risk level of a SQL query WITHOUT executing it. " +
        "Returns safe | warning | review | blocked with reasons and suggestions. " +
        "Use this before pg_execute_query to understand potential issues.",
      {
        query: z.string().describe("SQL query to classify")
      },
      async ({ query }) => {
        let graph: DatabaseGraph;
        try {
          graph = await getGraph(pool, config);
        } catch {
          // Fallback: classify without graph context (structural checks only)
          const result = classifyQueryRisk(query, [], {
            blockedSchemas: config.security.blockedSchemas,
            requireLimit: config.security.requireLimit,
            maxLimit: config.security.maxLimit
          });
          return ok({
            ...result,
            _note:
              "Graph unavailable; classification based on structural analysis only."
          });
        }

        const result = classifyQueryRisk(query, graph.tables, {
          blockedSchemas: config.security.blockedSchemas,
          requireLimit: config.security.requireLimit,
          maxLimit: config.security.maxLimit
        });

        return ok(result);
      }
    );
  }
}

// ---------------------------------------------------------------------------
// Summarize graph for compact output
// ---------------------------------------------------------------------------

function summarizeGraph(graph: DatabaseGraph): object {
  return {
    databaseName: graph.databaseName,
    builtAt: graph.builtAt,
    schemas: graph.schemas,
    tableCount: graph.tables.length,
    foreignKeyCount: graph.foreignKeys.length,
    inferredRelationCount: graph.inferredRelations.length,
    indexCount: graph.indexes.length,
    domainCount: graph.domains.length,
    tables: graph.tables.map((t) => ({
      schema: t.schema,
      name: t.name,
      probableType: t.probableType,
      riskLevel: t.riskLevel,
      allowedOperations: t.allowedOperations,
      columnCount: t.columns.length,
      sensitiveColumnCount: t.columns.filter((c) => c.isSensitive).length,
      rowEstimate: t.rowEstimate
    })),
    domains: graph.domains,
    _note: graph._note
  };
}

// ---------------------------------------------------------------------------
// Semantic tool names (exported for SUPPORTED_TOOLS)
// ---------------------------------------------------------------------------

export const SEMANTIC_TOOLS: readonly string[] = [
  "pg_inspect_database_graph",
  "pg_describe_table_semantics",
  "pg_find_related_tables",
  "pg_classify_query_risk"
];
