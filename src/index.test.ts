import { describe, test, expect } from "vitest";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  loadEnvFile,
  resolveCredential,
  buildConnectionString,
  DEFAULT_READONLY_TOOLS,
  WRITE_CAPABLE_TOOLS,
  SUPPORTED_TOOLS,
  hasMultipleStatements,
  isWriteOperation,
  MCP_INSTRUCTIONS
} from "./index";

// ---------------------------------------------------------------------------
// loadEnvFile
// ---------------------------------------------------------------------------
describe("loadEnvFile", () => {
  test("parses simple key=value pairs", () => {
    const file = join(tmpdir(), ".env-test-simple");
    writeFileSync(file, "DB_HOST=localhost\nDB_PORT=5432\n");
    const env = loadEnvFile(file);
    expect(env["DB_HOST"]).toBe("localhost");
    expect(env["DB_PORT"]).toBe("5432");
    unlinkSync(file);
  });

  test("strips surrounding quotes from values", () => {
    const file = join(tmpdir(), ".env-test-quotes");
    writeFileSync(file, "DB_PASS=\"my secret\"\nDB_USER='admin'\n");
    const env = loadEnvFile(file);
    expect(env["DB_PASS"]).toBe("my secret");
    expect(env["DB_USER"]).toBe("admin");
    unlinkSync(file);
  });

  test("ignores comment lines and blank lines", () => {
    const file = join(tmpdir(), ".env-test-comments");
    writeFileSync(file, "# comment\n\nDB_NAME=mydb\n");
    const env = loadEnvFile(file);
    expect(Object.keys(env).length).toBe(1);
    expect(env["DB_NAME"]).toBe("mydb");
    unlinkSync(file);
  });

  test("ignores lines without '='", () => {
    const file = join(tmpdir(), ".env-test-noeq");
    writeFileSync(file, "INVALID_LINE\nDB_NAME=mydb\n");
    const env = loadEnvFile(file);
    expect(env["DB_NAME"]).toBe("mydb");
    expect(env["INVALID_LINE"]).toBeUndefined();
    unlinkSync(file);
  });

  test("handles value containing '=' sign", () => {
    const file = join(tmpdir(), ".env-test-eqval");
    writeFileSync(file, "DB_PASS=abc=def=ghi\n");
    const env = loadEnvFile(file);
    expect(env["DB_PASS"]).toBe("abc=def=ghi");
    unlinkSync(file);
  });

  test("throws when file does not exist", () => {
    expect(() => loadEnvFile("/nonexistent/.env")).toThrow(
      /\.env file not found/
    );
  });
});

// ---------------------------------------------------------------------------
// resolveCredential
// ---------------------------------------------------------------------------
describe("resolveCredential", () => {
  test("uses mapped key from MCP_KEY_* env var", () => {
    const envVars = { MCP_KEY_HOST: "MY_HOST" };
    const dotenv = { MY_HOST: "db.example.com" };
    expect(resolveCredential(envVars, dotenv, "MCP_KEY_HOST", "DB_HOST")).toBe(
      "db.example.com"
    );
  });

  test("falls back to default key when MCP_KEY_* is absent", () => {
    const envVars: Record<string, string> = {};
    const dotenv = { DB_HOST: "fallback-host" };
    expect(resolveCredential(envVars, dotenv, "MCP_KEY_HOST", "DB_HOST")).toBe(
      "fallback-host"
    );
  });

  test("returns empty string when dotenv key is missing", () => {
    const envVars: Record<string, string> = {};
    const dotenv: Record<string, string> = {};
    expect(resolveCredential(envVars, dotenv, "MCP_KEY_HOST", "DB_HOST")).toBe(
      ""
    );
  });
});

// ---------------------------------------------------------------------------
// buildConnectionString
// ---------------------------------------------------------------------------
describe("buildConnectionString", () => {
  test("builds a valid postgresql connection string", () => {
    const result = buildConnectionString({
      host: "db.example.com",
      port: "5432",
      name: "mydb",
      sslmode: "require",
      user: "alice",
      pass: "secret"
    });
    expect(result).toBe(
      "postgresql://alice:secret@db.example.com:5432/mydb?sslmode=require"
    );
  });

  test("URL-encodes special characters in password", () => {
    const result = buildConnectionString({
      host: "localhost",
      port: "5432",
      name: "db",
      sslmode: "disable",
      user: "user",
      pass: "p@ss w0rd!"
    });
    expect(result).toContain("p%40ss%20w0rd!");
  });

  test("URL-encodes special characters in username", () => {
    const result = buildConnectionString({
      host: "localhost",
      port: "5432",
      name: "db",
      sslmode: "disable",
      user: "user@domain",
      pass: "pass"
    });
    expect(result).toContain("user%40domain");
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_READONLY_TOOLS - must contain only truly read-only tools
// ---------------------------------------------------------------------------
describe("DEFAULT_READONLY_TOOLS", () => {
  test("all default tools are present in SUPPORTED_TOOLS", () => {
    const missing = DEFAULT_READONLY_TOOLS.filter(
      (tool) => !SUPPORTED_TOOLS.includes(tool)
    );
    expect(missing).toEqual([]);
  });

  test("contains no write-capable tools", () => {
    const overlap = DEFAULT_READONLY_TOOLS.filter((tool) =>
      WRITE_CAPABLE_TOOLS.includes(tool)
    );
    expect(overlap).toEqual([]);
  });

  test("pg_manage_schema is NOT in default", () => {
    expect(DEFAULT_READONLY_TOOLS.includes("pg_manage_schema")).toBe(false);
  });

  test("pg_execute_mutation is NOT in default", () => {
    expect(DEFAULT_READONLY_TOOLS.includes("pg_execute_mutation")).toBe(false);
  });

  test("pg_execute_sql is NOT in default", () => {
    expect(DEFAULT_READONLY_TOOLS.includes("pg_execute_sql")).toBe(false);
  });

  test("pg_inspect_schema IS in default", () => {
    expect(DEFAULT_READONLY_TOOLS.includes("pg_inspect_schema")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// WRITE_CAPABLE_TOOLS - all must be in SUPPORTED_TOOLS
// ---------------------------------------------------------------------------
describe("WRITE_CAPABLE_TOOLS", () => {
  test("all write-capable tools are present in SUPPORTED_TOOLS", () => {
    const missing = WRITE_CAPABLE_TOOLS.filter(
      (tool) => !SUPPORTED_TOOLS.includes(tool)
    );
    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// hasMultipleStatements
// ---------------------------------------------------------------------------
describe("hasMultipleStatements", () => {
  test("returns false for a single SELECT", () => {
    expect(hasMultipleStatements("SELECT * FROM users")).toBe(false);
  });

  test("returns false for a single statement with a trailing semicolon", () => {
    expect(hasMultipleStatements("SELECT * FROM users;")).toBe(false);
  });

  test("returns true for two statements separated by semicolon", () => {
    expect(
      hasMultipleStatements("SELECT COUNT(*) FROM users; SELECT * FROM users")
    ).toBe(true);
  });

  test("returns false when semicolon appears only inside a string literal", () => {
    expect(
      hasMultipleStatements("SELECT * FROM users WHERE name = 'a;b'")
    ).toBe(false);
  });

  test("returns true when real separator exists alongside string with semicolon", () => {
    expect(hasMultipleStatements("SELECT 'a;b' FROM t; SELECT 1")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MCP_INSTRUCTIONS
// ---------------------------------------------------------------------------
describe("MCP_INSTRUCTIONS", () => {
  test("is a non-empty string", () => {
    expect(
      typeof MCP_INSTRUCTIONS === "string" && MCP_INSTRUCTIONS.length > 0
    ).toBe(true);
  });

  test("mentions pg_inspect_schema", () => {
    expect(MCP_INSTRUCTIONS).toContain("pg_inspect_schema");
  });

  test("does NOT mention pg_manage_schema (removed from default)", () => {
    expect(MCP_INSTRUCTIONS).not.toContain("pg_manage_schema");
  });

  test("mentions semicolon / multi-statement guidance", () => {
    expect(MCP_INSTRUCTIONS.toLowerCase()).toContain("semicolon");
  });
});

// ---------------------------------------------------------------------------
// isWriteOperation
// ---------------------------------------------------------------------------
describe("isWriteOperation", () => {
  // Should be blocked (returns true)
  for (const q of [
    "INSERT INTO t VALUES (1)",
    "UPDATE t SET x = 1",
    "DELETE FROM t",
    "CREATE TABLE t (id INT)",
    "ALTER TABLE t ADD COLUMN x INT",
    "DROP TABLE t",
    "TRUNCATE t",
    "GRANT SELECT ON t TO u",
    "REVOKE SELECT ON t FROM u",
    "COPY t FROM stdin",
    "MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN DELETE",
    "CALL my_proc()",
    "DO $$ BEGIN NULL; END $$",
    "VACUUM t",
    "ANALYZE t",
    "REINDEX TABLE t",
    "CLUSTER t USING idx",
    "COMMENT ON TABLE t IS 'x'",
    "EXPLAIN ANALYZE SELECT 1",
    "explain analyze select * from t",
    "EXPLAIN (ANALYZE TRUE, BUFFERS TRUE) SELECT 1",
    "  -- comment\nANALYZE t"
  ]) {
    test(`blocks: ${q.slice(0, 60)}`, () => {
      expect(isWriteOperation(q)).toBe(true);
    });
  }

  // Should be allowed (returns false)
  for (const q of [
    "SELECT * FROM t",
    "select count(*) from t",
    "EXPLAIN SELECT * FROM t",
    "EXPLAIN (FORMAT JSON) SELECT 1",
    "WITH cte AS (SELECT 1) SELECT * FROM cte"
  ]) {
    test(`allows: ${q.slice(0, 60)}`, () => {
      expect(isWriteOperation(q)).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// DATABASE_URL / MCP_KEY_URL support (resolveCredential covers the lookup;
// the integration is tested here via the helper directly)
// ---------------------------------------------------------------------------
describe("DATABASE_URL support via resolveCredential", () => {
  test("resolves DATABASE_URL from dotenv when no MCP_KEY_URL is set", () => {
    const envVars: Record<string, string> = {};
    const dotenv = { DATABASE_URL: "postgresql://user:pass@host:5432/mydb" };
    expect(
      resolveCredential(envVars, dotenv, "MCP_KEY_URL", "DATABASE_URL")
    ).toBe("postgresql://user:pass@host:5432/mydb");
  });

  test("resolves custom URL key when MCP_KEY_URL is mapped", () => {
    const envVars = { MCP_KEY_URL: "DB_URL" };
    const dotenv = {
      DB_URL: "postgresql://admin:secret@db.example.com:5432/prod"
    };
    expect(
      resolveCredential(envVars, dotenv, "MCP_KEY_URL", "DATABASE_URL")
    ).toBe("postgresql://admin:secret@db.example.com:5432/prod");
  });

  test("returns empty string when neither DATABASE_URL nor MCP_KEY_URL is set", () => {
    const envVars: Record<string, string> = {};
    const dotenv: Record<string, string> = {};
    expect(
      resolveCredential(envVars, dotenv, "MCP_KEY_URL", "DATABASE_URL")
    ).toBe("");
  });

  test("MCP_KEY_URL mapping takes precedence over DATABASE_URL", () => {
    const envVars = { MCP_KEY_URL: "CUSTOM_URL" };
    const dotenv = {
      CUSTOM_URL: "postgresql://user:pass@custom:5432/db",
      DATABASE_URL: "postgresql://other:other@other:5432/other"
    };
    expect(
      resolveCredential(envVars, dotenv, "MCP_KEY_URL", "DATABASE_URL")
    ).toBe("postgresql://user:pass@custom:5432/db");
  });
});

// ---------------------------------------------------------------------------
// vsceExtensionName (deploy.js helper — tested inline to keep test suite in TS)
// ---------------------------------------------------------------------------
describe("vsceExtensionName", () => {
  function vsceExtensionName(name: string): string {
    return name.replace(/^@[^/]+\//, "");
  }

  test("strips @scope/ prefix", () => {
    expect(vsceExtensionName("@edelciomolina/postgres-mcp")).toBe(
      "postgres-mcp"
    );
  });

  test("leaves plain name unchanged", () => {
    expect(vsceExtensionName("postgres-mcp")).toBe("postgres-mcp");
  });

  test("handles other scopes", () => {
    expect(vsceExtensionName("@myorg/my-extension")).toBe("my-extension");
  });
});
