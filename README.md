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
        "@edelciomolina/postgres-mcp",
        "tool=pg_manage_query",
        "tool=pg_manage_schema",
        "tool=pg_manage_indexes",
        "tool=pg_monitor_database"
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

```json
{
  "servers": {
    "Postgres Tools": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "@edelciomolina/postgres-mcp",
        "tool=pg_manage_query",
        "tool=pg_manage_schema",
        "tool=pg_manage_indexes",
        "tool=pg_monitor_database"
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

**⚠️ Excluded from defaults (write-capable, opt-in via `tool=` arg):**

| Tool | Risk |
|------|------|
| `pg_execute_mutation` | INSERT / UPDATE / DELETE / UPSERT operations |
| `pg_execute_sql`      | Executes arbitrary SQL with optional transaction support |

**✅ Included in defaults:**

```
pg_execute_query       pg_manage_query        pg_manage_schema
pg_manage_indexes      pg_manage_constraints  pg_manage_functions
pg_manage_triggers     pg_manage_rls          pg_get_setup_instructions
pg_manage_users        pg_analyze_database    pg_monitor_database
pg_debug_database
```

> 💡 `pg_execute_query` is included in the defaults but is **handler-enforced read-only**: the tool handler rejects any `INSERT`, `UPDATE`, `DELETE`, or DDL statement and returns a permission error before the database is contacted.

> ⚠️ Management tools like `pg_manage_schema` bundle both read and write sub-operations (e.g. `get_info` and `create_table`). For strict write prevention, pair with a database user that only has `SELECT` privileges.

> 💡 **Tip:** While this MCP is secure and customizable via tools, for maximum safety, pair the default tool set with a database user that only has `SELECT` privileges.

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
        "env-file=functions/.env",
        "tool=pg_manage_schema",
        "tool=pg_monitor_database"
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
| `pg_execute_query` | SELECT / COUNT / EXISTS with multi-statement and write-op guards |
| `pg_manage_query` | EXPLAIN plans, slow query analysis, `pg_stat_statements` |
| `pg_manage_schema` | Schema info, create/alter tables, manage ENUMs |
| `pg_manage_indexes` | Get, create, drop, reindex, analyze index usage |
| `pg_manage_constraints` | Get, create, and drop constraints and foreign keys |
| `pg_manage_functions` | Get, create, and drop functions/procedures |
| `pg_manage_triggers` | Get, create, drop, enable/disable triggers |
| `pg_manage_rls` | Row-Level Security policies |
| `pg_get_setup_instructions` | Platform-specific PostgreSQL setup instructions |
| `pg_manage_users` | User permissions, create/drop/alter users, grant/revoke |
| `pg_analyze_database` | Performance, configuration, and storage analysis |
| `pg_monitor_database` | Real-time connection, query, lock, and replication monitoring |
| `pg_debug_database` | Diagnose connections, locks, performance, and replication |

### Write-capable (opt-in via `tool=` arg)

| Tool | Description |
|------|-------------|
| `pg_execute_mutation` | INSERT / UPDATE / DELETE / UPSERT with parameterized queries |
| `pg_execute_sql` | Arbitrary SQL execution with optional transaction support |

---

## 🏗️ Architecture

For a deep dive into the communication flow between the MCP client, proxy, and PostgreSQL - including the full sequence diagram - see [ARCHITECT.md](ARCHITECT.md).

---

## 📄 License

MIT © [Edelcio Molina](https://github.com/edelciomolina)
