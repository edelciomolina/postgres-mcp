> 🌐 **English** | [Português](ARCHITECT_PT.md)

# Architecture

This document describes the communication flow between a MCP client and PostgreSQL when using `@edelciomolina/postgres-mcp`.

## Overview

`@edelciomolina/postgres-mcp` is a **proxy wrapper** that sits between the MCP client and the underlying `@henkey/postgres-mcp-server`. It adds three responsibilities that the child server does not handle:

| Responsibility | Where |
|---|---|
| Credential resolution from `.env` with configurable key mapping | Boot |
| Instruction injection into the MCP handshake | `initialize` response |
| Multi-statement query guard | Every `pg_execute_query` call |

---

## Communication Flow

```mermaid
sequenceDiagram
    actor Client as MCP Client<br/>(VS Code / Copilot)
    participant Proxy as postgres-mcp<br/>(Proxy Wrapper)
    participant Child as @henkey/postgres-mcp-server<br/>(Child Process)
    participant PG as PostgreSQL

    %% ── Boot ──────────────────────────────────────────────────────────
    note over Proxy: Boot
    Proxy->>Proxy: findEnvFile(cwd)
    Proxy->>Proxy: loadEnvFile(path)
    Proxy->>Proxy: resolveCredential × 6<br/>MCP_KEY_* → .env value
    Proxy->>Proxy: buildConnectionString<br/>(URL-encode user + pass)
    Proxy->>Proxy: writeFileSync(tempFile)<br/>{ enabledTools: DEFAULT_READONLY_TOOLS }
    Proxy->>Child: spawn()<br/>env: POSTGRES_CONNECTION_STRING

    %% ── Handshake ─────────────────────────────────────────────────────
    note over Client,PG: Handshake
    Client->>Proxy: initialize { clientInfo, capabilities }
    Proxy->>Child: initialize (passthrough)
    Child-->>Proxy: result { serverInfo, capabilities }
    note over Proxy: Detects result.serverInfo<br/>→ injects MCP_INSTRUCTIONS
    Proxy-->>Client: result { serverInfo, capabilities,<br/>instructions: MCP_INSTRUCTIONS }

    %% ── Schema check before query ─────────────────────────────────────
    note over Client,PG: Correct flow - inspect schema before querying
    Client->>Proxy: tools/call pg_manage_schema<br/>{ operation: "get_info", tableName: "users" }
    Proxy->>Child: tools/call pg_manage_schema (passthrough)
    Child->>PG: INFORMATION_SCHEMA query
    PG-->>Child: columns, types, constraints
    Child-->>Proxy: result { columns: [uid, display_name, ...] }
    Proxy-->>Client: result { columns: [uid, display_name, ...] }

    %% ── Valid single query ────────────────────────────────────────────
    Client->>Proxy: tools/call pg_execute_query<br/>{ operation: "select",<br/>  query: "SELECT uid, display_name FROM users" }
    Proxy->>Proxy: hasMultipleStatements(query)<br/>→ false ✅
    Proxy->>Child: tools/call pg_execute_query (passthrough)
    Child->>PG: SELECT uid, display_name FROM users
    PG-->>Child: rows[]
    Child-->>Proxy: result { rows }
    Proxy-->>Client: result { rows }

    %% ── Multi-statement blocked ───────────────────────────────────────
    note over Client,PG: Blocked flow - multi-statement rejected by the proxy
    Client->>Proxy: tools/call pg_execute_query<br/>{ query: "SELECT COUNT(*) FROM users#59;<br/>  SELECT * FROM users" }
    Proxy->>Proxy: hasMultipleStatements(query)<br/>→ true 🚫
    note over Proxy: Child never receives<br/>this message
    Proxy-->>Client: result { isError: true,<br/>"Multi-statement queries are not allowed.<br/>Split into separate calls." }

    %% ── Correct count ─────────────────────────────────────────────────
    Client->>Proxy: tools/call pg_execute_query<br/>{ operation: "count",<br/>  query: "SELECT COUNT(*) FROM users" }
    Proxy->>Proxy: hasMultipleStatements(query)<br/>→ false ✅
    Proxy->>Child: tools/call pg_execute_query (passthrough)
    Child->>PG: SELECT COUNT(*) FROM users
    PG-->>Child: [{ count: 1 }]
    Child-->>Proxy: result { rows }
    Proxy-->>Client: result { rows }
```

---

## Key design decisions

### 1. Proxy over fork
The wrapper spawns the child with `stdio: ["pipe", "pipe", "inherit"]`, giving it full control over stdin/stdout while letting stderr flow directly to the terminal. This enables interception without re-implementing the MCP protocol.

### 2. Instructions injected at handshake
The `initialize` response is the only message the proxy **modifies**. It appends `MCP_INSTRUCTIONS` to `result.instructions`, which the client reads once at startup. This guides the model to:
- Always call `pg_manage_schema` before referencing column names
- Never send multiple SQL statements in a single `pg_execute_query` call
- Use `operation="count"` for row counts

### 3. Multi-statement guard on the hot path
Every `tools/call` to `pg_execute_query` is inspected before being forwarded. If `hasMultipleStatements()` returns `true`, the proxy returns an MCP error response directly - the child process is never involved. String literals containing `;` are stripped before the check to avoid false positives (e.g. `WHERE name = 'a;b'`).

### 4. Credential isolation
Credentials never appear in MCP tool arguments or tool configs. They are resolved at boot from a `.env` file, encoded into a connection string, and injected as `POSTGRES_CONNECTION_STRING` into the child's environment. The key names can be remapped via `MCP_KEY_*` environment variables, allowing the same `.env` to serve multiple services without duplication.

### 5. Read-only by default
`DEFAULT_READONLY_TOOLS` omits all write/DDL tools (`pg_execute_mutation`, `pg_execute_sql`). Write access requires explicitly passing `tool=<name>` arguments at startup.
