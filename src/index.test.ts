import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import {
  loadEnvFile,
  resolveCredential,
  buildConnectionString,
  DEFAULT_READONLY_TOOLS
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
// Integration: verify DEFAULT_READONLY_TOOLS are all known to the henkey server
// ---------------------------------------------------------------------------
describe("DEFAULT_READONLY_TOOLS compatibility", () => {
  test("all default tools are recognised by @henkey/postgres-mcp-server", () => {
    const toolsFile = join(tmpdir(), `mcp-pg-tools-test-${process.pid}.json`);
    writeFileSync(
      toolsFile,
      JSON.stringify({ enabledTools: DEFAULT_READONLY_TOOLS }, null, 2)
    );

    const henkeyBin = resolve(
      __dirname,
      "../node_modules/@henkey/postgres-mcp-server/build/index.js"
    );

    // Spawn the henkey server briefly. It will load the tools config, print any
    // "not found in available tools" warnings to stderr, then block on stdio
    // transport — so we kill it immediately after collecting stderr output.
    const result = spawnSync(
      process.execPath,
      [henkeyBin, "--tools-config", toolsFile],
      {
        timeout: 5000,
        env: {
          ...process.env,
          POSTGRES_CONNECTION_STRING: "postgresql://x:x@localhost:5432/x",
          NODE_TLS_REJECT_UNAUTHORIZED: "0"
        }
      }
    );

    try {
      unlinkSync(toolsFile);
    } catch {
      /* ignore */
    }

    const stderr = result.stderr?.toString() ?? "";
    const unknownTools = [
      ...stderr.matchAll(
        /\[MCP Warning\] Tool "([^"]+)" specified in config file but not found in available tools/g
      )
    ].map((m) => m[1]);

    assert.deepEqual(
      unknownTools,
      [],
      `The following tools in DEFAULT_READONLY_TOOLS are not available in @henkey/postgres-mcp-server: ${unknownTools.join(", ")}\n` +
        `Check if the tool names changed in a new version of @henkey/postgres-mcp-server.\n` +
        `Full stderr:\n${stderr}`
    );
  });
});
