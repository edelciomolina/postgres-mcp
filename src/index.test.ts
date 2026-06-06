import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  loadEnvFile,
  resolveCredential,
  buildConnectionString,
  DEFAULT_READONLY_TOOLS,
  SUPPORTED_TOOLS,
  hasMultipleStatements,
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
    assert.equal(env["DB_HOST"], "localhost");
    assert.equal(env["DB_PORT"], "5432");
    unlinkSync(file);
  });

  test("strips surrounding quotes from values", () => {
    const file = join(tmpdir(), ".env-test-quotes");
    writeFileSync(file, "DB_PASS=\"my secret\"\nDB_USER='admin'\n");
    const env = loadEnvFile(file);
    assert.equal(env["DB_PASS"], "my secret");
    assert.equal(env["DB_USER"], "admin");
    unlinkSync(file);
  });

  test("ignores comment lines and blank lines", () => {
    const file = join(tmpdir(), ".env-test-comments");
    writeFileSync(file, "# comment\n\nDB_NAME=mydb\n");
    const env = loadEnvFile(file);
    assert.equal(Object.keys(env).length, 1);
    assert.equal(env["DB_NAME"], "mydb");
    unlinkSync(file);
  });

  test("ignores lines without '='", () => {
    const file = join(tmpdir(), ".env-test-noeq");
    writeFileSync(file, "INVALID_LINE\nDB_NAME=mydb\n");
    const env = loadEnvFile(file);
    assert.equal(env["DB_NAME"], "mydb");
    assert.equal(env["INVALID_LINE"], undefined);
    unlinkSync(file);
  });

  test("handles value containing '=' sign", () => {
    const file = join(tmpdir(), ".env-test-eqval");
    writeFileSync(file, "DB_PASS=abc=def=ghi\n");
    const env = loadEnvFile(file);
    assert.equal(env["DB_PASS"], "abc=def=ghi");
    unlinkSync(file);
  });

  test("throws when file does not exist", () => {
    assert.throws(
      () => loadEnvFile("/nonexistent/.env"),
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
    assert.equal(
      resolveCredential(envVars, dotenv, "MCP_KEY_HOST", "DB_HOST"),
      "db.example.com"
    );
  });

  test("falls back to default key when MCP_KEY_* is absent", () => {
    const envVars: Record<string, string> = {};
    const dotenv = { DB_HOST: "fallback-host" };
    assert.equal(
      resolveCredential(envVars, dotenv, "MCP_KEY_HOST", "DB_HOST"),
      "fallback-host"
    );
  });

  test("returns empty string when dotenv key is missing", () => {
    const envVars: Record<string, string> = {};
    const dotenv: Record<string, string> = {};
    assert.equal(
      resolveCredential(envVars, dotenv, "MCP_KEY_HOST", "DB_HOST"),
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
    assert.equal(
      result,
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
    assert.ok(result.includes("p%40ss%20w0rd!"));
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
    assert.ok(result.includes("user%40domain"));
  });
});

// ---------------------------------------------------------------------------
// Integration: verify DEFAULT_READONLY_TOOLS are all implemented by this server
// ---------------------------------------------------------------------------
describe("DEFAULT_READONLY_TOOLS compatibility", () => {
  test("all default tools are present in SUPPORTED_TOOLS", () => {
    const missing = DEFAULT_READONLY_TOOLS.filter(
      (tool) => !SUPPORTED_TOOLS.includes(tool)
    );
    assert.deepEqual(
      missing,
      [],
      `The following tools in DEFAULT_READONLY_TOOLS are not implemented: ${missing.join(", ")}`
    );
  });
});

// ---------------------------------------------------------------------------
// hasMultipleStatements
// ---------------------------------------------------------------------------
describe("hasMultipleStatements", () => {
  test("returns false for a single SELECT", () => {
    assert.equal(hasMultipleStatements("SELECT * FROM users"), false);
  });

  test("returns false for a single statement with a trailing semicolon", () => {
    assert.equal(hasMultipleStatements("SELECT * FROM users;"), false);
  });

  test("returns true for two statements separated by semicolon", () => {
    assert.equal(
      hasMultipleStatements("SELECT COUNT(*) FROM users; SELECT * FROM users"),
      true
    );
  });

  test("returns false when semicolon appears only inside a string literal", () => {
    assert.equal(
      hasMultipleStatements("SELECT * FROM users WHERE name = 'a;b'"),
      false
    );
  });

  test("returns true when real separator exists alongside string with semicolon", () => {
    assert.equal(hasMultipleStatements("SELECT 'a;b' FROM t; SELECT 1"), true);
  });
});

// ---------------------------------------------------------------------------
// MCP_INSTRUCTIONS
// ---------------------------------------------------------------------------
describe("MCP_INSTRUCTIONS", () => {
  test("is a non-empty string", () => {
    assert.ok(
      typeof MCP_INSTRUCTIONS === "string" && MCP_INSTRUCTIONS.length > 0
    );
  });

  test("mentions pg_manage_schema", () => {
    assert.ok(MCP_INSTRUCTIONS.includes("pg_manage_schema"));
  });

  test("mentions semicolon / multi-statement guidance", () => {
    assert.ok(MCP_INSTRUCTIONS.toLowerCase().includes("semicolon"));
  });
});
