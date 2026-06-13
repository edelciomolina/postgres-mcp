/**
 * Type definitions for the PostgreSQL Knowledge Graph.
 *
 * All objects tagged with `isInferred: true` are derived from
 * naming patterns or heuristics, NOT from explicit database metadata.
 * The LLM should treat inferred information as hints, not facts.
 */

// ---------------------------------------------------------------------------
// Column classification
// ---------------------------------------------------------------------------

/**
 * The semantic role a column plays in the data model.
 * - `primary_key` / `foreign_key` - structural role
 * - `identifier`   - unique business identifier (email, username, slug, uuid)
 * - `timestamp`    - created_at, updated_at, deleted_at, etc.
 * - `status`       - state machine fields (active, state, phase, step)
 * - `flag`         - boolean fields (is_*, has_*, enabled, active)
 * - `amount`       - monetary or numeric values (price, total, cost, amount)
 * - `sensitive`    - password, token, secret, hash, ssn, credit, key
 * - `label`        - human-readable names (name, title, description, label)
 * - `json_blob`    - jsonb / json columns
 * - `generic`      - everything else
 */
export type ColumnSemanticRole =
  | "primary_key"
  | "foreign_key"
  | "identifier"
  | "timestamp"
  | "status"
  | "flag"
  | "amount"
  | "sensitive"
  | "label"
  | "json_blob"
  | "generic";

export interface ColumnNode {
  name: string;
  dataType: string;
  isNullable: boolean;
  columnDefault: string | null;
  semanticRole: ColumnSemanticRole;
  isSensitive: boolean;
  isInferred: boolean;
}

// ---------------------------------------------------------------------------
// Table classification
// ---------------------------------------------------------------------------

/**
 * Structural archetype inferred for a table.
 * - `entity`    - main business objects (users, products, orders)
 * - `junction`  - many-to-many join tables (user_roles, order_items)
 * - `audit`     - history/log tables (*_log, *_audit, *_history)
 * - `lookup`    - reference/enum-like tables (countries, statuses, categories)
 * - `config`    - settings/configuration tables
 * - `unknown`   - could not classify
 */
export type TableType =
  | "entity"
  | "junction"
  | "audit"
  | "lookup"
  | "config"
  | "unknown";

/**
 * Safety level of a table from the LLM's perspective.
 * - `safe`        - low-risk, can be queried freely
 * - `medium`      - context-dependent, PII possible
 * - `sensitive`   - contains sensitive data; queries should be logged/reviewed
 * - `restricted`  - should not be queried without explicit user approval
 */
export type RiskLevel = "safe" | "medium" | "sensitive" | "restricted";

export type AllowedOperation =
  | "inspect"
  | "describe"
  | "count"
  | "bounded_select"
  | "unrestricted_select";

export interface TableNode {
  schema: string;
  name: string;
  tableType: "BASE TABLE" | "VIEW" | string;
  probableType: TableType;
  riskLevel: RiskLevel;
  allowedOperations: AllowedOperation[];
  columns: ColumnNode[];
  rowEstimate: number | null;
  isInferred: boolean;
}

// ---------------------------------------------------------------------------
// Relationship edges
// ---------------------------------------------------------------------------

export interface ForeignKeyEdge {
  constraintName: string;
  fromSchema: string;
  fromTable: string;
  fromColumn: string;
  toSchema: string;
  toTable: string;
  toColumn: string;
  onDelete: string | null;
  onUpdate: string | null;
}

/**
 * A relationship inferred from naming patterns (e.g. `user_id` → `users.id`),
 * NOT from an explicit foreign key constraint.
 */
export interface InferredRelationEdge {
  fromSchema: string;
  fromTable: string;
  fromColumn: string;
  toSchema: string;
  toTable: string;
  toColumn: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  isInferred: true;
}

// ---------------------------------------------------------------------------
// Index info
// ---------------------------------------------------------------------------

export interface IndexInfo {
  schema: string;
  table: string;
  indexName: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
}

// ---------------------------------------------------------------------------
// Business domain (inferred grouping of tables)
// ---------------------------------------------------------------------------

export interface BusinessDomain {
  name: string;
  tables: string[];
  isInferred: true;
}

// ---------------------------------------------------------------------------
// Top-level graph
// ---------------------------------------------------------------------------

export interface DatabaseGraph {
  databaseName: string;
  builtAt: string;
  schemas: string[];
  tables: TableNode[];
  foreignKeys: ForeignKeyEdge[];
  inferredRelations: InferredRelationEdge[];
  indexes: IndexInfo[];
  domains: BusinessDomain[];
  _note: "Inferred fields are derived from naming patterns and heuristics. They are hints, not guarantees.";
}
