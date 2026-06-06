#!/usr/bin/env node
/**
 * @edelciomolina/postgres-mcp
 * MCP server wrapper for PostgreSQL - reads credentials from .env at runtime.
 *
 * Author: Edelcio Molina <https://github.com/edelciomolina>
 */

import { spawn } from "child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { URL as NodeURL } from "url";

// ---------------------------------------------------------------------------
// Default read-only tools (no pg_execute_mutation / pg_execute_sql)
// Note: @henkey/postgres-mcp-server >=1.0.5 uses consolidated tools that bundle
// multiple operations (read + write) under a single name. These defaults exclude
// write/DDL execution tools but include pg_execute_query (SELECT-only) and all
// management tools whose read operations cover the old individual tools
// (e.g. pg_get_schema_info is now pg_manage_schema with operation="get_info").
// ---------------------------------------------------------------------------
export const DEFAULT_READONLY_TOOLS = [
  "pg_execute_query", // read-only SELECT execution (select / count / exists operations)
  "pg_manage_query", // explain, slow queries, query stats (was: pg_explain_query, pg_get_slow_queries, pg_get_query_stats)
  "pg_manage_schema", // schema info, enums (was: pg_get_schema_info, pg_get_enums)
  "pg_manage_indexes", // index info + usage analysis (was: pg_get_indexes, pg_analyze_index_usage)
  "pg_manage_constraints", // constraint info (was: pg_get_constraints)
  "pg_manage_functions", // function info (was: pg_get_functions)
  "pg_manage_triggers", // trigger info (was: pg_get_triggers)
  "pg_manage_rls", // RLS policy info (was: pg_get_rls_policies)
  "pg_get_setup_instructions",
  "pg_manage_users", // user permissions info (was: pg_get_user_permissions)
  "pg_analyze_database",
  "pg_monitor_database",
  "pg_debug_database"
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
    if (parent === dir) return null; // reached filesystem root
    dir = parent;
  }
}

// ---------------------------------------------------------------------------
// Multi-statement query guard
// ---------------------------------------------------------------------------
export function hasMultipleStatements(query: string): boolean {
  // Strip single-quoted string literals to avoid false positives (e.g. WHERE col = 'a;b')
  const stripped = query.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  const withoutTrailing = stripped.trim().replace(/;+\s*$/, "");
  return withoutTrailing.includes(";");
}

// ---------------------------------------------------------------------------
// Write-operation guard
// ---------------------------------------------------------------------------
export function isWriteOperation(query: string): boolean {
  // Strip comments before checking
  const stripped = query
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "")
    .trim();
  return /^(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP|CREATE|ALTER|REPLACE|GRANT|REVOKE|COPY)\b/i.test(
    stripped
  );
}

// ---------------------------------------------------------------------------
// Instructions injected into the MCP initialize response
// ---------------------------------------------------------------------------
export const MCP_INSTRUCTIONS =
  "PostgreSQL query rules:\n" +
  '1. Always call pg_manage_schema(operation="get_info", tableName="<table>") before ' +
  "writing any query that references specific column names.\n" +
  "2. Never send multiple SQL statements separated by semicolons in a single " +
  "pg_execute_query call — split each statement into a separate tool invocation.\n" +
  '3. For row counts, prefer operation="count" over embedding SELECT COUNT inside a ' +
  "multi-statement query.\n" +
  "4. Permission boundaries: if a tool rejects an operation due to insufficient " +
  "permissions, stop immediately and inform the user — do NOT attempt to work around " +
  "the restriction via terminal commands, psql, reading .env files, or any other means. " +
  "Clearly state which tool was used, what permission it lacks, and what configuration " +
  "change would be needed to perform the operation.";

// ---------------------------------------------------------------------------
// Line-buffered NDJSON reader
// ---------------------------------------------------------------------------
function readLines(
  readable: NodeJS.ReadableStream,
  onLine: (line: string) => void
): void {
  let buffer = "";
  readable.on("data", (chunk: Buffer | string) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    for (const line of lines) {
      if (line.trim()) onLine(line);
    }
  });
  readable.on("end", () => {
    if (buffer.trim()) onLine(buffer);
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
  const cwd = process.cwd();

  // Explicit env-file=<path> arg takes priority; otherwise walk up from cwd
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

  // Collect tools from args: tool=<name>  (env-file= args are excluded)
  const tools = process.argv
    .slice(2)
    .filter((a) => a.startsWith("tool="))
    .map((a) => a.slice(5));

  const enabledTools = tools.length > 0 ? tools : DEFAULT_READONLY_TOOLS;

  // Write temp tools config
  const toolsFile = join(tmpdir(), `mcp-pg-tools-${process.pid}.json`);
  writeFileSync(toolsFile, JSON.stringify({ enabledTools }, null, 2));

  const connStr = buildConnectionString({
    host,
    port,
    name,
    sslmode,
    user,
    pass
  });

  process.env["POSTGRES_CONNECTION_STRING"] = connStr;
  process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

  const child = spawn(
    "npx",
    ["-y", "@henkey/postgres-mcp-server", "--tools-config", toolsFile],
    { env: process.env, stdio: ["pipe", "pipe", "inherit"] }
  );

  // stdin: MCP client → proxy → child (multi-statement guard)
  readLines(process.stdin, (line) => {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      child.stdin!.write(line + "\n");
      return;
    }

    if (
      msg.method === "tools/call" &&
      msg.params?.name === "pg_execute_query" &&
      typeof msg.params?.arguments?.query === "string" &&
      hasMultipleStatements(msg.params.arguments.query)
    ) {
      const rejection = JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [
            {
              type: "text",
              text: "Error: Multi-statement queries (multiple SQL statements separated by semicolons) are not allowed. Split each statement into a separate pg_execute_query call."
            }
          ],
          isError: true
        }
      });
      process.stdout.write(rejection + "\n");
      return;
    }

    // Write-operation guard: pg_execute_query is read-only
    if (
      msg.method === "tools/call" &&
      msg.params?.name === "pg_execute_query" &&
      typeof msg.params?.arguments?.query === "string" &&
      isWriteOperation(msg.params.arguments.query)
    ) {
      const rejection = JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [
            {
              type: "text",
              text:
                "Permission denied: pg_execute_query only supports read-only operations " +
                "(SELECT / COUNT / EXISTS). Write operations (INSERT, UPDATE, DELETE, DDL) " +
                "are not permitted in this MCP configuration.\n\n" +
                "Do NOT attempt to work around this restriction using terminal commands, " +
                "psql, reading .env files, or any other means. " +
                "To perform write operations, the MCP server must be reconfigured to " +
                "include a write-enabled tool (e.g. pg_execute_sql)."
            }
          ],
          isError: true
        }
      });
      process.stdout.write(rejection + "\n");
      return;
    }

    // Disabled-tool guard: reject calls to tools not in the enabled list
    if (
      msg.method === "tools/call" &&
      typeof msg.params?.name === "string" &&
      !enabledTools.includes(msg.params.name)
    ) {
      const rejection = JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [
            {
              type: "text",
              text:
                `Permission denied: the tool "${msg.params.name}" is not enabled in this ` +
                "MCP configuration.\n\n" +
                "Available tools: " +
                enabledTools.join(", ") +
                ".\n\n" +
                "Do NOT attempt to work around this restriction using terminal commands, " +
                "psql, reading .env files, or any other means. " +
                "To use this tool, the MCP server must be reconfigured to include it."
            }
          ],
          isError: true
        }
      });
      process.stdout.write(rejection + "\n");
      return;
    }

    child.stdin!.write(line + "\n");
  });

  process.stdin.on("end", () => child.stdin!.end());

  // stdout: child → proxy → MCP client (instructions injection)
  readLines(child.stdout!, (line) => {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stdout.write(line + "\n");
      return;
    }

    // Inject guidance instructions into the initialize response
    if (msg.result?.serverInfo) {
      const enhanced = {
        ...msg,
        result: {
          ...msg.result,
          instructions:
            MCP_INSTRUCTIONS +
            (msg.result.instructions ? "\n\n" + msg.result.instructions : "")
        }
      };
      process.stdout.write(JSON.stringify(enhanced) + "\n");
      return;
    }

    process.stdout.write(line + "\n");
  });

  child.on("error", (err) => {
    process.stderr.write(`ERROR: Failed to start MCP server: ${err.message}\n`);
    try {
      unlinkSync(toolsFile);
    } catch {}
    process.exit(1);
  });

  child.on("exit", (code) => {
    try {
      unlinkSync(toolsFile);
    } catch {}
    process.exit(code ?? 0);
  });
}

// Only run main when this file is executed directly (not imported by tests)
if (require.main === module) {
  main();
}
