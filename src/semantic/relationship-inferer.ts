import type {
  TableNode,
  ForeignKeyEdge,
  InferredRelationEdge,
  BusinessDomain
} from "./graph-types.js";

/**
 * Infers probable relationships between tables that lack explicit foreign keys,
 * based on naming patterns (e.g. `user_id` column in `orders` → `users` table).
 *
 * All results are tagged isInferred: true with a confidence level and reason.
 * The LLM should treat these as hints to explore, not as schema facts.
 */
export function inferRelations(
  tables: TableNode[],
  existingFKs: ForeignKeyEdge[]
): InferredRelationEdge[] {
  const results: InferredRelationEdge[] = [];

  // Build lookup: table name (lowercase) → TableNode
  const tableByName = new Map<string, TableNode>();
  for (const t of tables) {
    tableByName.set(t.name.toLowerCase(), t);
  }

  // Build set of already-known FK pairs to avoid duplicates
  const knownFKs = new Set<string>(
    existingFKs.map(
      (fk) =>
        `${fk.fromSchema}.${fk.fromTable}.${fk.fromColumn}→${fk.toSchema}.${fk.toTable}.${fk.toColumn}`
    )
  );

  for (const table of tables) {
    for (const col of table.columns) {
      if (col.semanticRole !== "foreign_key") continue;

      const colLower = col.name.toLowerCase();

      // Pattern: <something>_id → <something> table or <something>s table
      if (!colLower.endsWith("_id")) continue;
      const base = colLower.slice(0, -3); // strip "_id"

      const candidates = [
        base, // user_id → user
        pluralize(base), // user_id → users
        singularize(base), // users_id → user
        base.replace(/_/g, "") // order_item_id → orderitem (rare, low confidence)
      ];

      for (let i = 0; i < candidates.length; i++) {
        const candidateName = candidates[i];
        const targetTable = tableByName.get(candidateName);
        if (!targetTable) continue;
        if (
          targetTable.schema === table.schema &&
          targetTable.name === table.name
        )
          continue;

        const key = `${table.schema}.${table.name}.${col.name}→${targetTable.schema}.${targetTable.name}.id`;
        if (knownFKs.has(key)) continue;

        knownFKs.add(key); // prevent duplicate inferences

        const confidence =
          i === 0 ? "high" : i === 1 ? "high" : i === 2 ? "medium" : "low";

        const reason =
          `Column "${col.name}" in "${table.schema}.${table.name}" matches ` +
          `table name "${targetTable.name}" by naming pattern.`;

        results.push({
          fromSchema: table.schema,
          fromTable: table.name,
          fromColumn: col.name,
          toSchema: targetTable.schema,
          toTable: targetTable.name,
          toColumn: "id",
          confidence,
          reason,
          isInferred: true
        });
        break; // one inference per column is enough
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Business domain inference
// ---------------------------------------------------------------------------

/**
 * Groups tables into probable business domains based on:
 * 1. Shared FK relationships (explicit and inferred)
 * 2. Common name prefixes
 *
 * Domains are always inferred and tagged isInferred: true.
 */
export function inferDomains(
  tables: TableNode[],
  foreignKeys: ForeignKeyEdge[],
  inferredRelations: InferredRelationEdge[]
): BusinessDomain[] {
  // Build adjacency using both FK types
  const adjacency = new Map<string, Set<string>>();

  const addEdge = (from: string, to: string) => {
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    if (!adjacency.has(to)) adjacency.set(to, new Set());
    adjacency.get(from)!.add(to);
    adjacency.get(to)!.add(from);
  };

  for (const fk of foreignKeys) {
    addEdge(`${fk.fromSchema}.${fk.fromTable}`, `${fk.toSchema}.${fk.toTable}`);
  }
  for (const rel of inferredRelations) {
    if (rel.confidence !== "low") {
      addEdge(
        `${rel.fromSchema}.${rel.fromTable}`,
        `${rel.toSchema}.${rel.toTable}`
      );
    }
  }

  // Connected components via union-find
  const parent = new Map<string, string>();
  const allKeys = new Set<string>([
    ...adjacency.keys(),
    ...tables.map((t) => `${t.schema}.${t.name}`)
  ]);

  for (const k of allKeys) parent.set(k, k);

  function find(x: string): string {
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  }
  function union(a: string, b: string) {
    parent.set(find(a), find(b));
  }

  for (const [node, neighbors] of adjacency) {
    for (const neighbor of neighbors) {
      union(node, neighbor);
    }
  }

  // Group tables by component root
  const components = new Map<string, string[]>();
  for (const k of allKeys) {
    const root = find(k);
    if (!components.has(root)) components.set(root, []);
    components.get(root)!.push(k);
  }

  // Build domains from components with >1 table
  const domains: BusinessDomain[] = [];
  for (const [, members] of components) {
    if (members.length < 2) continue;

    // Try to infer a domain name from common prefix
    const tableNames = members.map((m) => m.split(".").pop()!);
    const domainName = inferDomainName(tableNames);

    domains.push({
      name: domainName,
      tables: members.sort(),
      isInferred: true
    });
  }

  return domains.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pluralize(word: string): string {
  if (word.endsWith("y")) return word.slice(0, -1) + "ies";
  if (word.endsWith("s") || word.endsWith("x") || word.endsWith("z"))
    return word + "es";
  return word + "s";
}

function singularize(word: string): string {
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.endsWith("ses") || word.endsWith("xes") || word.endsWith("zes"))
    return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function inferDomainName(tableNames: string[]): string {
  if (tableNames.length === 0) return "unknown";

  // Find longest common prefix
  let prefix = tableNames[0];
  for (const name of tableNames.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < name.length && prefix[i] === name[i]) i++;
    prefix = prefix.slice(0, i);
  }

  // Strip trailing underscores or partial words
  const cleanPrefix =
    prefix.replace(/_+$/, "").replace(/_\w+$/, "") || prefix.replace(/_+$/, "");

  if (cleanPrefix.length >= 3) return cleanPrefix;

  // Fall back to the most central table name (heuristic: the one referenced most often)
  return tableNames.sort((a, b) => a.length - b.length)[0];
}
