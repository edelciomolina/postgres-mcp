> 🌐 **English** | [Português](README_PT.md)

<table border="0" cellspacing="0" cellpadding="0">
  <tr>
    <td width="110">
      <img src="https://raw.githubusercontent.com/edelciomolina/postgres-mcp/main/icon.png" width="96" alt="Postgres MCP icon"/>
    </td>
    <td>
      <h1>Postgres MCP</h1>
      <p>🔌 Native MCP server for PostgreSQL - reads credentials from <code>.env</code> at runtime with flexible key mapping, configurable tool selection, and <strong>safe read-only defaults</strong>.</p>
      <a href="https://www.npmjs.com/package/@edelciomolina/postgres-mcp"><img src="https://img.shields.io/npm/v/@edelciomolina/postgres-mcp" alt="npm version"/></a>
      <a href="https://www.npmjs.com/package/@edelciomolina/postgres-mcp"><img src="https://img.shields.io/npm/l/%40edelciomolina%2Fpostgres-mcp" alt="license"/></a>
      <a href="https://github.com/edelciomolina/postgres-mcp/actions/workflows/ci.yml"><img src="https://github.com/edelciomolina/postgres-mcp/actions/workflows/ci.yml/badge.svg" alt="CI"/></a>
    </td>
  </tr>
</table>

---

## ✨ What it does

This is a **native MCP server** built directly with [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) and [`pg`](https://www.npmjs.com/package/pg) (node-postgres). It provides:

- 🔐 **Runtime credential resolution** - reads database credentials from your `.env` file at startup, so no secrets are stored in `mcp.json`
- 🗝️ **Flexible key mapping** - use any `.env` variable names; tell the server which ones to use via `env` in `mcp.json`
- 🎯 **Explicit tool selection** - pass `tool=<name>` args to choose exactly which MCP tools to expose
- 🛡️ **Read-only by default** - if no tools are specified, only safe introspection tools are enabled (no writes, no arbitrary SQL execution)

---

## 📋 Requirements

- ⚙️ Node.js >= 18
- 📄 A `.env` file with the database credentials (anywhere in the project tree - see [.env discovery](#-env-file-discovery))

---

## � Installation

There are two ways to use this package. Choose the one that best fits your workflow.

### Option 1 - No install (via `npx`, recommended for quick start)

No installation required. `npx` downloads and runs the package on demand. Add `-y` as the first arg to skip the confirmation prompt.

```json
{
  "servers": {
    "Postgres Tools": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@edelciomolina/postgres-mcp"
      ],
      "env": {
        "MCP_KEY_HOST":    "DB_HOST",
        "MCP_KEY_PORT":    "DB_PORT",
        "MCP_KEY_NAME":    "DB_NAME",
        "MCP_KEY_SSLMODE": "DB_SSLMODE",
        "MCP_KEY_USER":    "DB_USER",
        "MCP_KEY_PASS":    "DB_PASS"
      }
    }
  }
}
```

This starts the server with the **read-only default tool set** - no `tool=` args needed. To enable write-capable tools, see [Write-capable tools](#write-capable-opt-in-via-tool-arg).

---

### Option 2 - Install via VS Code (MCP extension marketplace)

VS Code supports discovering and installing MCP servers directly from the editor, without touching the terminal.

1. Open the **Command Palette** (<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> on Mac / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> on Windows/Linux)
2. Run **`MCP: Add Server`**
3. Choose **"Browser MCP Servers"** (or **"From registry"**, depending on your VS Code version)
4. Search for **`postgres-mcp`** or **`edelciomolina`**
5. Select **Postgres MCP** and follow the prompts - VS Code will add the entry to your `mcp.json` automatically

> 💡 You can also open the MCP Servers panel via the **Copilot chat icon → Manage MCP Servers** to browse, enable, or disable servers at any time.

After installing, edit the generated entry in `.vscode/mcp.json` to add your `tool=` args and `env` key mappings as shown in the [Usage](#-usage-in-vs-code-mcpjson) section below.

---

## 🚀 Usage in VS Code (`mcp.json`)

**Read-only (default - no `tool=` args needed):**

```json
{
  "servers": {
    "Postgres Tools": {
      "type": "stdio",
      "command": "npx",
      "args": ["@edelciomolina/postgres-mcp"],
      "env": {
        "MCP_KEY_HOST":    "DB_HOST",
        "MCP_KEY_PORT":    "DB_PORT",
        "MCP_KEY_NAME":    "DB_NAME",
        "MCP_KEY_SSLMODE": "DB_SSLMODE",
        "MCP_KEY_USER":    "DB_USER",
        "MCP_KEY_PASS":    "DB_PASS"
      }
    }
  }
}
```

**With write-capable tools (explicit opt-in required):**

```json
{
  "servers": {
    "Postgres Tools": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "@edelciomolina/postgres-mcp",
        "tool=pg_manage_schema",
        "tool=pg_manage_indexes"
      ],
      "env": {
        "POSTGRES_MCP_ALLOW_WRITE": "true",
        "MCP_KEY_HOST":    "DB_HOST",
        "MCP_KEY_PORT":    "DB_PORT",
        "MCP_KEY_NAME":    "DB_NAME",
        "MCP_KEY_SSLMODE": "DB_SSLMODE",
        "MCP_KEY_USER":    "DB_USER",
        "MCP_KEY_PASS":    "DB_PASS"
      }
    }
  }
}
```

> ⚠️ Write-capable tools require `POSTGRES_MCP_ALLOW_WRITE=true` in `env`. Without it, the server exits on startup.

The corresponding `.env` in your project root:

```env
DB_HOST=db.your-project.supabase.co
DB_PORT=5432
DB_NAME=postgres
DB_SSLMODE=require
DB_USER=readonly_user
DB_PASS=your_password
```

---

## ⚙️ How `mcp.json` configuration works

### 🗝️ `env` - credential key mapping

The `env` block does **not** contain the actual credentials. It maps each `MCP_KEY_*` to the name of the variable in your `.env` file.

| Key in `env`   | Points to `.env` variable | Example value           |
|----------------|---------------------------|-------------------------|
| `MCP_KEY_HOST` | `DB_HOST`                 | `db.example.supabase.co`|
| `MCP_KEY_PORT` | `DB_PORT`                 | `5432`                  |
| `MCP_KEY_NAME` | `DB_NAME`                 | `postgres`              |
| `MCP_KEY_SSLMODE` | `DB_SSLMODE`           | `require`               |
| `MCP_KEY_USER` | `DB_USER`                 | `readonly_user`         |
| `MCP_KEY_PASS` | `DB_PASS`                 | `secret`                |

This indirection means you can use **any variable names** in your `.env` - useful when sharing an `.env` across multiple services with different naming conventions.

### 🔧 `args` - tool selection via `tool=` prefix

Each enabled MCP tool is declared as a separate arg using the `tool=<name>` format:

```json
"args": [
  "-y",
  "@edelciomolina/postgres-mcp",
  "tool=pg_manage_schema",
  "tool=pg_manage_indexes"
]
```

This makes the tool list **explicit and auditable** directly in `mcp.json` - no hidden config files. 🔍

---

## 🛡️ Why read-only is the default

If you omit all `tool=` args, the server starts with a **curated read-only set** - every tool that can retrieve, analyze, or explain data, but nothing that can modify it.

**✅ Included in defaults (read-only):**

```
pg_execute_query    pg_manage_query    pg_inspect_schema
pg_get_setup_instructions              pg_analyze_database
pg_monitor_database                    pg_debug_database
```

> 💡 `pg_execute_query` rejects `INSERT`, `UPDATE`, `DELETE`, DDL, `ANALYZE`, `VACUUM`, `EXPLAIN ANALYZE`, and other write/maintenance commands before the database is contacted.

> 💡 `pg_inspect_schema` provides read-only schema introspection (`get_info`, `get_enums`). For DDL operations use `pg_manage_schema` with explicit opt-in.

**⚠️ Excluded from defaults - require `tool=` arg AND `POSTGRES_MCP_ALLOW_WRITE=true`:**

| Tool | Operations |
|------|------------|
| `pg_manage_schema` | CREATE TABLE, ALTER TABLE, CREATE TYPE |
| `pg_manage_indexes` | CREATE INDEX, DROP INDEX, REINDEX |
| `pg_manage_constraints` | ADD CONSTRAINT, DROP CONSTRAINT |
| `pg_manage_functions` | CREATE FUNCTION, DROP FUNCTION |
| `pg_manage_triggers` | CREATE TRIGGER, DROP TRIGGER, enable/disable |
| `pg_manage_rls` | ENABLE/DISABLE RLS, CREATE/ALTER/DROP POLICY |
| `pg_manage_users` | CREATE/DROP/ALTER USER, GRANT, REVOKE |
| `pg_execute_mutation` | INSERT / UPDATE / DELETE / UPSERT |
| `pg_execute_sql` | Arbitrary SQL with optional transaction |

---

## 📍 `.env` file discovery

The server resolves the `.env` file in this order:

1. **`env-file=<path>` arg** - explicit path relative to `cwd`; takes priority over everything else
2. **Walk-up** - starting from `cwd`, searches each parent directory until a `.env` is found or the filesystem root is reached

If no `.env` is found, the server exits with a clear error message.

### Monorepos and subfolders

When VS Code starts the MCP process, `cwd` is typically the workspace root. If your `.env` lives in a subfolder (e.g. `functions/.env`), use `env-file=` to point to it explicitly:

```json
{
  "servers": {
    "Postgres Tools": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@edelciomolina/postgres-mcp",
        "env-file=functions/.env"
      ],
      "env": {
        "MCP_KEY_HOST":    "DB_HOST",
        "MCP_KEY_PORT":    "DB_PORT",
        "MCP_KEY_NAME":    "DB_NAME",
        "MCP_KEY_SSLMODE": "DB_SSLMODE",
        "MCP_KEY_USER":    "DB_USER",
        "MCP_KEY_PASS":    "DB_PASS"
      }
    }
  }
}
```

> 💡 The walk-up behavior handles the common case automatically. Use `env-file=` when you need explicit control (CI, monorepos, Docker bind-mounts).

---

## 🧰 Available tools

### Read-only (enabled by default)

| Tool | Description |
|------|-------------|
| `pg_execute_query` | SELECT / COUNT / EXISTS with write-op and multi-statement guards |
| `pg_manage_query` | EXPLAIN plans, slow query analysis, `pg_stat_statements` |
| `pg_inspect_schema` | Schema info and ENUM types (read-only introspection) |
| `pg_get_setup_instructions` | Platform-specific PostgreSQL setup instructions |
| `pg_analyze_database` | Performance, configuration, and storage analysis |
| `pg_monitor_database` | Real-time connection, query, lock, and replication monitoring |
| `pg_debug_database` | Diagnose connections, locks, performance, and replication |

### Write-capable (opt-in via `tool=` arg + `POSTGRES_MCP_ALLOW_WRITE=true`)

| Tool | Description |
|------|-------------|
| `pg_manage_schema` | Schema info, create/alter tables, manage ENUMs |
| `pg_manage_indexes` | Get, create, drop, reindex, analyze index usage |
| `pg_manage_constraints` | Get, create, and drop constraints and foreign keys |
| `pg_manage_functions` | Get, create, and drop functions/procedures |
| `pg_manage_triggers` | Get, create, drop, enable/disable triggers |
| `pg_manage_rls` | Row-Level Security policies |
| `pg_manage_users` | User permissions, create/drop/alter users, grant/revoke |
| `pg_execute_mutation` | INSERT / UPDATE / DELETE / UPSERT with parameterized queries |
| `pg_execute_sql` | Arbitrary SQL execution with optional transaction support |

---

## 🏗️ Architecture

For a deep dive into the communication flow between the MCP client, proxy, and PostgreSQL - including the full sequence diagram - see [ARCHITECT.md](ARCHITECT.md).

---

## 📄 License

MIT © [Edelcio Molina](https://github.com/edelciomolina)
