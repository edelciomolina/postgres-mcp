# 🐘 Postgres MCP

> 🔌 MCP server wrapper for PostgreSQL - reads credentials from `.env` at runtime with flexible key mapping, configurable tool selection, and **safe read-only defaults**.

[![npm version](https://img.shields.io/npm/v/@edelciomolina/postgres-mcp)](https://www.npmjs.com/package/@edelciomolina/postgres-mcp)
[![license](https://img.shields.io/npm/l/@edelciomolina/postgres-mcp)](./LICENSE.md)

---

## ✨ What it does

This package wraps [@henkey/postgres-mcp-server](https://github.com/HenkDz/postgresql-mcp-server) and adds:

- 🔐 **Runtime credential resolution** - reads database credentials from your `.env` file at startup, so no secrets are stored in `mcp.json`
- 🗝️ **Flexible key mapping** - use any `.env` variable names; tell the server which ones to use via `env` in `mcp.json`
- 🎯 **Explicit tool selection** - pass `tool=<name>` args to choose exactly which MCP tools to expose
- 🛡️ **Read-only by default** - if no tools are specified, only safe introspection tools are enabled (no writes, no arbitrary SQL execution)

---

## 📋 Requirements

- ⚙️ Node.js >= 18
- 📄 A `.env` file in your project root with the database credentials

---

## 🚀 Usage in VS Code (`mcp.json`)

```json
{
  "servers": {
    "Postgres": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "@edelciomolina/postgres-mcp",
        "tool=pg_explain_query",
        "tool=pg_get_schema_info",
        "tool=pg_get_indexes",
        "tool=pg_get_slow_queries",
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
  "npx @edelciomolina/postgres-mcp",
  "tool=pg_get_schema_info",
  "tool=pg_get_indexes"
]
```

This makes the tool list **explicit and auditable** directly in `mcp.json` - no hidden config files. 🔍

---

## 🛡️ Why read-only is the default

If you omit all `tool=` args, the server starts with a **curated read-only set** - every tool that can retrieve, analyze, or explain data, but nothing that can modify it.

**⚠️ Excluded from defaults (write-capable):**

| Tool | Risk |
|------|------|
| `pg_execute_query` | Runs arbitrary SQL - including `INSERT`, `UPDATE`, `DELETE`, `DROP` |
| `pg_manage_query`  | Executes saved queries - can include mutations |

**✅ Included in defaults (safe read-only):**

```
pg_explain_query       pg_get_schema_info     pg_get_indexes
pg_get_constraints     pg_get_functions       pg_get_triggers
pg_get_rls_policies    pg_get_enums           pg_get_setup_instructions
pg_get_slow_queries    pg_get_query_stats     pg_get_user_permissions
pg_analyze_database    pg_analyze_index_usage pg_monitor_database
pg_debug_database
```

> 💡 **Tip:** While this MCP is secure and customizable via tools, for maximum safety, pair the read-only tool set with a database user that only has `SELECT` privileges.

---

## 🧰 Available tools

See the full list of available tools in the underlying server:  
📦 [@henkey/postgres-mcp-server](https://github.com/HenkDz/postgresql-mcp-server)

---

## 📄 License

MIT © [Edelcio Molina](https://github.com/edelciomolina)
