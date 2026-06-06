#!/usr/bin/env node
/**
 * @edelciomolina/postgres-mcp
 * MCP server wrapper for PostgreSQL - reads credentials from .env at runtime.
 *
 * Author: Edelcio Molina <https://github.com/edelciomolina>
 */

import { execFileSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { URL as NodeURL } from "url";

// ---------------------------------------------------------------------------
// Default read-only tools (no pg_execute_query / pg_manage_query)
// ---------------------------------------------------------------------------
const DEFAULT_READONLY_TOOLS = [
  "pg_explain_query",
  "pg_get_schema_info",
  "pg_get_indexes",
  "pg_get_constraints",
  "pg_get_functions",
  "pg_get_triggers",
  "pg_get_rls_policies",
  "pg_get_enums",
  "pg_get_setup_instructions",
  "pg_get_slow_queries",
  "pg_get_query_stats",
  "pg_get_user_permissions",
  "pg_analyze_database",
  "pg_analyze_index_usage",
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
// Main
// ---------------------------------------------------------------------------
function main(): void {
  // Locate .env - walk up from cwd to find it
  const cwd = process.cwd();
  const envPath = resolve(cwd, ".env");

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

  // Collect tools from args: tool=<name>
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

  try {
    execFileSync(
      "npx",
      ["-y", "@henkey/postgres-mcp-server", "--tools-config", toolsFile],
      { stdio: "inherit", env: process.env }
    );
  } finally {
    try {
      unlinkSync(toolsFile);
    } catch {}
  }
}

// Only run main when this file is executed directly (not imported by tests)
if (require.main === module) {
  main();
}
