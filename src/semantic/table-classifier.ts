import type { ColumnNode, ColumnSemanticRole } from "./graph-types.js";

/**
 * Classifies a single column based on its name, data type, and structural role.
 * All classifications are heuristic and tagged with isInferred: true.
 */
export function classifyColumn(
  name: string,
  dataType: string,
  isNullable: boolean,
  columnDefault: string | null,
  isPrimaryKey: boolean,
  isForeignKey: boolean,
  sensitiveKeywords: string[]
): ColumnNode {
  const role = resolveSemanticRole(name, dataType, isPrimaryKey, isForeignKey);
  const isSensitive =
    role === "sensitive" ||
    sensitiveKeywords.some((kw) =>
      name.toLowerCase().includes(kw.toLowerCase())
    );

  return {
    name,
    dataType,
    isNullable,
    columnDefault,
    semanticRole: role,
    isSensitive,
    isInferred: true
  };
}

function resolveSemanticRole(
  name: string,
  dataType: string,
  isPrimaryKey: boolean,
  isForeignKey: boolean
): ColumnSemanticRole {
  const lower = name.toLowerCase();
  const dt = dataType.toLowerCase();

  if (isPrimaryKey) return "primary_key";
  if (isForeignKey || /_id$/.test(lower) || lower.endsWith("_fk"))
    return "foreign_key";

  // Sensitive fields - checked before generic label matching
  if (SENSITIVE_PATTERNS.some((p) => p.test(lower))) return "sensitive";

  // JSON blob
  if (dt === "json" || dt === "jsonb") return "json_blob";

  // Timestamp / date
  if (
    TIMESTAMP_PATTERNS.some((p) => p.test(lower)) ||
    dt.includes("timestamp") ||
    dt === "date" ||
    dt === "time"
  ) {
    return "timestamp";
  }

  // Boolean flag
  if (
    dt === "boolean" ||
    lower.startsWith("is_") ||
    lower.startsWith("has_") ||
    lower.startsWith("can_") ||
    lower.startsWith("should_") ||
    lower === "active" ||
    lower === "enabled" ||
    lower === "deleted" ||
    lower === "archived"
  ) {
    return "flag";
  }

  // Status / state machine
  if (STATUS_PATTERNS.some((p) => p.test(lower))) return "status";

  // Monetary / numeric amount
  if (AMOUNT_PATTERNS.some((p) => p.test(lower))) return "amount";

  // Unique business identifiers
  if (IDENTIFIER_PATTERNS.some((p) => p.test(lower))) return "identifier";

  // Human-readable labels
  if (LABEL_PATTERNS.some((p) => p.test(lower))) return "label";

  return "generic";
}

// ---------------------------------------------------------------------------
// Pattern sets
// ---------------------------------------------------------------------------

const SENSITIVE_PATTERNS = [
  /password/i,
  /passwd/i,
  /\bpass\b/i,
  /secret/i,
  /\btoken\b/i,
  /api_?key/i,
  /credential/i,
  /credit_?card/i,
  /\bssn\b/i,
  /private_?key/i,
  /\bhash\b/i,
  /\bsalt\b/i,
  /\bauth\b/i,
  /\botp\b/i,
  /\bpin\b/i
];

const TIMESTAMP_PATTERNS = [
  /created_?at/i,
  /updated_?at/i,
  /deleted_?at/i,
  /modified_?at/i,
  /expires?_?at/i,
  /started_?at/i,
  /ended_?at/i,
  /published_?at/i,
  /sent_?at/i,
  /confirmed_?at/i,
  /verified_?at/i,
  /\bdate\b/i,
  /_date$/i,
  /_time$/i,
  /_at$/i,
  /_on$/i
];

const STATUS_PATTERNS = [
  /\bstatus\b/i,
  /\bstate\b/i,
  /\bphase\b/i,
  /\bstage\b/i,
  /\bstep\b/i,
  /\bstep\b/i,
  /\bworkflow\b/i,
  /\blifecycle\b/i
];

const AMOUNT_PATTERNS = [
  /\bprice\b/i,
  /\bcost\b/i,
  /\bamount\b/i,
  /\btotal\b/i,
  /\bsubtotal\b/i,
  /\bbalance\b/i,
  /\bfee\b/i,
  /\btax\b/i,
  /\bdiscount\b/i,
  /\bsalary\b/i,
  /\bwage\b/i,
  /\brevenue\b/i,
  /\bprofit\b/i,
  /\bmargin\b/i,
  /\bquantity\b/i,
  /\bqty\b/i,
  /\bunits\b/i
];

const IDENTIFIER_PATTERNS = [
  /^email$/i,
  /\bemail\b/i,
  /\busername\b/i,
  /\bslug\b/i,
  /\buuid\b/i,
  /\bcode\b/i,
  /\bref\b/i,
  /\breference\b/i,
  /\bexternal_id/i,
  /\bpublic_id/i,
  /\buid\b/i,
  /\bsku\b/i,
  /\bbarcode\b/i,
  /\bnumber\b/i
];

const LABEL_PATTERNS = [
  /\bname\b/i,
  /\btitle\b/i,
  /\blabel\b/i,
  /\bdescription\b/i,
  /\bdesc\b/i,
  /\bsummary\b/i,
  /\bcomment\b/i,
  /\bnote\b/i,
  /\bnotes\b/i,
  /\bbio\b/i,
  /\bcaption\b/i,
  /\bsubtitle\b/i,
  /\bheadline\b/i,
  /\bcontent\b/i,
  /\bbody\b/i,
  /\btext\b/i,
  /\bmessage\b/i
];
