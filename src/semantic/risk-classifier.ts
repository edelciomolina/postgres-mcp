import type {
  TableNode,
  TableType,
  RiskLevel,
  AllowedOperation,
  ColumnNode
} from "./graph-types.js";

/**
 * Classifies a table by its probable structural type and risk level.
 * Returns a fully populated TableNode with semantic metadata.
 * All classifications are heuristic and tagged with isInferred: true.
 */
export function classifyTable(
  schema: string,
  name: string,
  tableType: string,
  columns: ColumnNode[],
  rowEstimate: number | null,
  blockedTables: string[]
): TableNode {
  const lower = name.toLowerCase();
  const qualifiedName = `${schema}.${name}`;

  const isBlocked =
    blockedTables.includes(name) || blockedTables.includes(qualifiedName);

  const probableType = inferTableType(lower, columns);
  const riskLevel = inferRiskLevel(lower, columns, isBlocked);
  const allowedOperations = resolveAllowedOperations(riskLevel);

  return {
    schema,
    name,
    tableType,
    probableType,
    riskLevel,
    allowedOperations,
    columns,
    rowEstimate,
    isInferred: true
  };
}

// ---------------------------------------------------------------------------
// Table type inference
// ---------------------------------------------------------------------------

function inferTableType(lower: string, columns: ColumnNode[]): TableType {
  // Audit / history / log tables
  if (
    lower.endsWith("_log") ||
    lower.endsWith("_logs") ||
    lower.endsWith("_audit") ||
    lower.endsWith("_history") ||
    lower.endsWith("_events") ||
    lower.endsWith("_changelog") ||
    lower.endsWith("_archive")
  ) {
    return "audit";
  }

  // Config / settings tables
  if (
    lower === "settings" ||
    lower === "config" ||
    lower === "configuration" ||
    lower === "preferences" ||
    lower === "options" ||
    (lower.startsWith("app_") &&
      (lower.endsWith("_config") || lower.endsWith("_settings"))) ||
    lower.endsWith("_config") ||
    lower.endsWith("_settings")
  ) {
    return "config";
  }

  // Lookup / reference tables (small enum-like tables)
  if (
    lower.endsWith("_type") ||
    lower.endsWith("_types") ||
    lower.endsWith("_status") ||
    lower.endsWith("_statuses") ||
    lower.endsWith("_category") ||
    lower.endsWith("_categories") ||
    lower.endsWith("_code") ||
    lower.endsWith("_codes") ||
    lower === "countries" ||
    lower === "currencies" ||
    lower === "timezones" ||
    lower === "languages"
  ) {
    return "lookup";
  }

  // Junction / join tables - typically two or more FK columns and few others
  const fkColumns = columns.filter((c) => c.semanticRole === "foreign_key");
  const nonMetaColumns = columns.filter(
    (c) =>
      c.semanticRole !== "primary_key" &&
      c.semanticRole !== "foreign_key" &&
      c.semanticRole !== "timestamp"
  );
  if (
    fkColumns.length >= 2 &&
    nonMetaColumns.length <= 2 &&
    columns.length <= 8
  ) {
    return "junction";
  }

  // Default to entity
  return "entity";
}

// ---------------------------------------------------------------------------
// Risk level inference
// ---------------------------------------------------------------------------

function inferRiskLevel(
  lower: string,
  columns: ColumnNode[],
  isBlocked: boolean
): RiskLevel {
  if (isBlocked) return "restricted";

  const hasSensitiveColumn = columns.some((c) => c.isSensitive);

  // Explicitly high-risk table names
  if (
    lower === "users" ||
    lower === "user" ||
    lower === "accounts" ||
    lower === "account" ||
    lower === "customers" ||
    lower === "customer" ||
    lower === "members" ||
    lower === "member" ||
    lower === "employees" ||
    lower === "employee" ||
    lower === "staff" ||
    lower === "admin" ||
    lower === "admins" ||
    lower === "credentials" ||
    lower === "sessions" ||
    lower === "api_keys" ||
    lower === "tokens" ||
    lower === "secrets" ||
    lower === "payments" ||
    lower === "payment" ||
    lower === "billing" ||
    lower === "invoices" ||
    lower === "invoice" ||
    lower === "transactions" ||
    lower === "transaction"
  ) {
    return hasSensitiveColumn ? "sensitive" : "medium";
  }

  if (hasSensitiveColumn) return "sensitive";

  // Tables with PII-suggesting names
  if (
    lower.includes("personal") ||
    lower.includes("profile") ||
    lower.includes("private") ||
    lower.includes("confidential") ||
    lower.includes("medical") ||
    lower.includes("health") ||
    lower.includes("financial") ||
    lower.includes("salary") ||
    lower.includes("payroll")
  ) {
    return "medium";
  }

  return "safe";
}

// ---------------------------------------------------------------------------
// Allowed operations per risk level
// ---------------------------------------------------------------------------

function resolveAllowedOperations(riskLevel: RiskLevel): AllowedOperation[] {
  switch (riskLevel) {
    case "safe":
      return [
        "inspect",
        "describe",
        "count",
        "bounded_select",
        "unrestricted_select"
      ];
    case "medium":
      return ["inspect", "describe", "count", "bounded_select"];
    case "sensitive":
      return ["inspect", "describe", "count"];
    case "restricted":
      return ["inspect"];
  }
}

// ---------------------------------------------------------------------------
// Query risk classification (used by pg_classify_query_risk)
// ---------------------------------------------------------------------------

export type QueryRiskLevel = "safe" | "warning" | "review" | "blocked";

export interface QueryRiskResult {
  level: QueryRiskLevel;
  reasons: string[];
  suggestions: string[];
}

/**
 * Classifies the risk of a SQL query without executing it.
 * Uses the in-memory graph to check referenced tables when possible.
 */
export function classifyQueryRisk(
  query: string,
  tables: TableNode[],
  config: { blockedSchemas: string[]; requireLimit: boolean; maxLimit: number }
): QueryRiskResult {
  const reasons: string[] = [];
  const suggestions: string[] = [];
  let level: QueryRiskLevel = "safe";

  const stripped = query
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "")
    .trim()
    .toUpperCase();

  // Block all write/DDL operations
  const writePattern =
    /^(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP|CREATE|ALTER|REPLACE|GRANT|REVOKE|COPY|CALL|DO|VACUUM|ANALYZE|REINDEX|CLUSTER|COMMENT)\b/;
  if (writePattern.test(stripped)) {
    reasons.push("Query contains a write or DDL operation.");
    suggestions.push(
      "Use pg_execute_mutation or pg_execute_sql (write tools) for mutations."
    );
    return { level: "blocked", reasons, suggestions };
  }

  // Block EXPLAIN ANALYZE
  if (/^EXPLAIN\b/.test(stripped) && /\bANALYZE\b/.test(stripped)) {
    reasons.push(
      "EXPLAIN ANALYZE executes the query and may cause side-effects."
    );
    suggestions.push(
      "Use EXPLAIN (without ANALYZE) to inspect query plans safely."
    );
    return { level: "blocked", reasons, suggestions };
  }

  // Check for blocked schemas
  for (const schema of config.blockedSchemas) {
    if (new RegExp(`\\b${schema}\\b`, "i").test(query)) {
      reasons.push(`Query references blocked schema: ${schema}`);
      suggestions.push(
        `Remove reference to schema "${schema}" from your query.`
      );
      level = "blocked";
    }
  }
  if (level === "blocked") return { level, reasons, suggestions };

  // Check for missing LIMIT
  if (config.requireLimit && !/\bLIMIT\s+\d+/i.test(query)) {
    reasons.push("Query has no LIMIT clause.");
    suggestions.push(
      `Add LIMIT ${config.maxLimit} or less to avoid returning too many rows.`
    );
    level = "warning";
  }

  // Check referenced tables for risk level
  const tableMap = new Map(tables.map((t) => [t.name.toLowerCase(), t]));
  const identifierPattern =
    /\bFROM\s+(?:"?(\w+)"?\.)?"?(\w+)"?\b|\bJOIN\s+(?:"?(\w+)"?\.)?"?(\w+)"?\b/gi;
  let match: RegExpExecArray | null;
  const referencedTables: TableNode[] = [];

  while ((match = identifierPattern.exec(query)) !== null) {
    const tableName = (match[2] || match[4] || "").toLowerCase();
    const node = tableMap.get(tableName);
    if (node) referencedTables.push(node);
  }

  for (const table of referencedTables) {
    if (table.riskLevel === "restricted") {
      reasons.push(
        `Table "${table.schema}.${table.name}" is restricted and should not be queried.`
      );
      suggestions.push(
        `Remove "${table.name}" from your query or request explicit access.`
      );
      level = "blocked";
    } else if (table.riskLevel === "sensitive" && level !== "blocked") {
      reasons.push(
        `Table "${table.schema}.${table.name}" contains sensitive data (risk: ${table.riskLevel}).`
      );
      suggestions.push(
        `Ensure you only select non-sensitive columns from "${table.name}".`
      );
      const hasSensitiveCols = table.columns.some((c) => c.isSensitive);
      if (hasSensitiveCols) {
        const sensitiveNames = table.columns
          .filter((c) => c.isSensitive)
          .map((c) => c.name)
          .join(", ");
        suggestions.push(
          `Sensitive columns in "${table.name}": ${sensitiveNames}. Avoid selecting them.`
        );
      }
      level = "review";
    } else if (table.riskLevel === "medium" && level === "safe") {
      reasons.push(
        `Table "${table.schema}.${table.name}" may contain PII (risk: ${table.riskLevel}).`
      );
      level = "warning";
    }
  }

  if (level === "safe" && reasons.length === 0) {
    reasons.push("No issues detected.");
  }

  return { level, reasons, suggestions };
}
