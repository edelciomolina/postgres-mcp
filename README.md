> **English** | 🌐 [Português](README_PT.md)

<table border="0" cellspacing="0" cellpadding="0">
  <tr>
    <td width="110">
      <img src="https://raw.githubusercontent.com/edelciomolina/postgres-mcp/main/icon.png" width="96" alt="Postgres MCP Icon"/>
    </td>
    <td>
      <h1>Postgres MCP</h1>
      <p>🔌 Native MCP server for PostgreSQL - reads credentials from <code>.env</code> at runtime with flexible key mapping, configurable tool selection, and <strong>read-only mode by default</strong>.</p>
      <a href="https://www.npmjs.com/package/@edelciomolina/postgres-mcp"><img src="https://img.shields.io/npm/v/@edelciomolina/postgres-mcp" alt="npm version"/></a>
      <a href="https://www.npmjs.com/package/@edelciomolina/postgres-mcp"><img src="https://img.shields.io/npm/l/%40edelciomolina%2Fpostgres-mcp" alt="license"/></a>
      <a href="https://github.com/edelciomolina/postgres-mcp/actions/workflows/ci.yml"><img src="https://github.com/edelciomolina/postgres-mcp/actions/workflows/ci.yml/badge.svg" alt="CI"/></a>
    </td>
  </tr>
</table>

---

## ✨ What it does

Most LLMs interact with databases by guessing - assuming table names, inventing column names, and writing queries that may fail or expose sensitive data. Postgres MCP solves this by giving the LLM a **structured, safe interface** to actually understand the database before touching it.

Built with [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) and [`pg`](https://www.npmjs.com/package/pg), it provides:

- 🧠 **Semantic knowledge graph** - the LLM gets a complete map of schemas, tables, columns, foreign keys, inferred relations, risk levels, and business domains - built from the real schema, not invented
- 🛡️ **Read-only by default** - no writes, no DDL, no arbitrary SQL unless you explicitly opt in; `pg_classify_query_risk` lets the LLM check a query's safety before running it
- 🔐 **Runtime credential resolution** - credentials are read from `.env` at startup; nothing sensitive lives in `mcp.json`
- 🎯 **Explicit tool selection** - every tool is opt-in via `tool=<name>` args, so the LLM only sees what you choose to expose

---

## 📋 Requirements

- ⚙️ Node.js >= 18
- 📄 A `.env` file with database credentials (anywhere in the project tree - see [.env Discovery](#-env-file-discovery))

---

## 🚀 Installation

There are two ways to use this package. Choose the one that best fits your workflow.

### Option 1 - No installation (via `npx`, recommended for quick start)

No installation needed. `npx` downloads and runs the package on demand. Add `-y` as the first argument to skip the confirmation prompt.

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

This starts the server with the **default read-only tool set** - no `tool=` arguments needed. To enable write-capable tools, see [Write-capable tools](#write-capable-opt-in-via-tool-argument).

> 💡 **Using Supabase, Neon, Railway or another platform that only provides a connection string?** Use `MCP_KEY_URL` pointing to `DATABASE_URL` (or whatever variable name the platform uses). The server will prioritize the URL and ignore the individual variables. See [Connection via URL](#-connection-via-url-database_url).

---

### Option 2 - Install via VS Code (MCP extension marketplace)

VS Code supports discovering and installing MCP servers directly in the editor, without using the terminal.

1. Open the **Command Palette** (<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> on Mac / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> on Windows/Linux)
2. Run **`MCP: Add Server`**
3. Choose **"Browse MCP Servers"** (or **"From registry"**, depending on your VS Code version)
4. Search for **`postgres-mcp`** or **`edelciomolina`**
5. Select **Postgres MCP** and follow the instructions - VS Code will add the entry to your `mcp.json` automatically

> 💡 You can also open the MCP Servers panel via **Copilot chat icon → Manage MCP Servers** to browse, enable, or disable servers at any time.

After installing, edit the generated entry in `.vscode/mcp.json` to add your `tool=` arguments and `env` key mappings as shown in the [Usage](#-usage-in-vs-code-mcpjson) section below.

---

## 🚀 Usage in VS Code (`mcp.json`)

**Read-only (default - no `tool=` arguments needed):**

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

**With write tools (explicit opt-in required):**

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

> ⚠️ Write-capable tools require `POSTGRES_MCP_ALLOW_WRITE=true` in `env`. Without it, the server exits at startup.

The corresponding `.env` file at the root of your project:

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

The `env` block does **not** contain the actual credentials. It maps each `MCP_KEY_*` to the variable name in your `.env` file.

| Key in `env`      | Points to `.env` variable   | Example value            |
|-------------------|-----------------------------|--------------------------|
| `MCP_KEY_URL`     | `DATABASE_URL`              | `postgresql://user:pass@host:5432/db?sslmode=require` |
| `MCP_KEY_HOST`    | `DB_HOST`                   | `db.example.supabase.co` |
| `MCP_KEY_PORT`    | `DB_PORT`                   | `5432`                   |
| `MCP_KEY_NAME`    | `DB_NAME`                   | `postgres`               |
| `MCP_KEY_SSLMODE` | `DB_SSLMODE`                | `require`                |
| `MCP_KEY_USER`    | `DB_USER`                   | `readonly_user`          |
| `MCP_KEY_PASS`    | `DB_PASS`                   | `secret`                 |

> **Priority:** when `MCP_KEY_URL` (or `DATABASE_URL`) is present, the server uses the URL directly and **ignores** the individual credential keys.

This indirection lets you use **any variable name** in your `.env` - useful when sharing a `.env` across multiple services with different naming conventions.

### 🔧 `args` - tool selection via `tool=` prefix

Each enabled MCP tool is declared as a separate argument in the format `tool=<name>`:

```json
"args": [
  "-y",
  "@edelciomolina/postgres-mcp",
  "tool=pg_manage_schema",
  "tool=pg_manage_indexes"
]
```

This makes the tool list **explicit and auditable** directly in `mcp.json` - no hidden configuration files. 🔍

---

## 🔗 Connection via URL (`DATABASE_URL`)

In addition to individual credentials, you can provide a **full connection string** - the standard format on platforms like Supabase, Neon, and Railway.

**`.env`:**
```env
DATABASE_URL=postgresql://user:password@host:5432/database?sslmode=require
```

**`mcp.json`:**
```json
{
  "servers": {
    "Postgres Tools": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@edelciomolina/postgres-mcp"],
      "env": {
        "MCP_KEY_URL": "DATABASE_URL"
      }
    }
  }
}
```

The variable mapped by `MCP_KEY_URL` has **priority** over the other keys (`MCP_KEY_HOST`, `MCP_KEY_PORT`, etc.). If the URL is present, the other variables are ignored.

If the platform uses a different name (e.g. `DB_URL`), just adjust the mapping:
```json
"MCP_KEY_URL": "DB_URL"
```

---

## 🛡️ Why read-only is the default

If you omit all `tool=` arguments, the server starts with a **curated read-only set** - all tools that can retrieve, analyze, or explain data, but nothing that can modify it.

**✅ Included in defaults (read-only):**

```
pg_execute_query       pg_manage_query        pg_inspect_schema
pg_get_setup_instructions                     pg_analyze_database
pg_monitor_database                           pg_debug_database
pg_inspect_database_graph                     pg_describe_table_semantics
pg_find_related_tables                        pg_classify_query_risk
```

> 💡 `pg_execute_query` rejects `INSERT`, `UPDATE`, `DELETE`, DDL, `ANALYZE`, `VACUUM`, `EXPLAIN ANALYZE` and other write/maintenance commands before the database is queried.

> 💡 `pg_inspect_schema` provides read-only schema introspection (`get_info`, `get_enums`). For DDL operations, use `pg_manage_schema` with explicit opt-in.

**⚠️ Excluded from defaults - require `tool=` argument AND `POSTGRES_MCP_ALLOW_WRITE=true`:**

| Tool | Operations |
|------|-----------|
| `pg_manage_schema` | CREATE TABLE, ALTER TABLE, CREATE TYPE |
| `pg_manage_indexes` | CREATE INDEX, DROP INDEX, REINDEX |
| `pg_manage_constraints` | ADD CONSTRAINT, DROP CONSTRAINT |
| `pg_manage_functions` | CREATE FUNCTION, DROP FUNCTION |
| `pg_manage_triggers` | CREATE TRIGGER, DROP TRIGGER, enable/disable |
| `pg_manage_rls` | ENABLE/DISABLE RLS, CREATE/ALTER/DROP POLICY |
| `pg_manage_users` | CREATE/DROP/ALTER USER, GRANT, REVOKE |
| `pg_execute_mutation` | INSERT / UPDATE / DELETE / UPSERT |
| `pg_execute_sql` | Arbitrary SQL with transaction support |

---

## 📍 `.env` file discovery

The server resolves the `.env` file in this order:

1. **`env-file=<path>` argument** - explicit path relative to `cwd`; takes priority over everything
2. **Upward search** - starting from `cwd`, searches each parent directory until a `.env` is found or the filesystem root is reached

If no `.env` is found, the server exits with a clear error message.

### Monorepos and subfolders

When VS Code starts the MCP process, `cwd` is typically the workspace root. If your `.env` is in a subfolder (e.g. `functions/.env`), use `env-file=` to point to it explicitly:

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

> 💡 The upward search behavior handles the common case automatically. Use `env-file=` when you need explicit control (CI, monorepos, Docker bind-mounts).

---

## 🧰 Available tools

### Read-only (enabled by default)

| Tool | Description |
|------|-------------|
| `pg_execute_query` | SELECT / COUNT / EXISTS with write and multi-statement guards |
| `pg_manage_query` | EXPLAIN plans, slow query analysis, `pg_stat_statements` |
| `pg_inspect_schema` | Schema info and ENUM types (read-only introspection) |
| `pg_get_setup_instructions` | Setup instructions per platform |
| `pg_analyze_database` | Performance, configuration, and storage analysis |
| `pg_monitor_database` | Real-time monitoring of connections, queries, locks, and replication |
| `pg_debug_database` | Diagnose connections, locks, performance, and replication |
| `pg_inspect_database_graph` | Build a full knowledge graph of the database: schemas, tables, columns, FKs, indexes, inferred relations, and business domains |
| `pg_describe_table_semantics` | Describe a table with semantic context: risk level, column roles, sensitive columns, and related tables |
| `pg_find_related_tables` | Find tables related to a given table via explicit FKs and inferred naming patterns, with path explanation |
| `pg_classify_query_risk` | Classify query risk (`safe` / `warning` / `review` / `blocked`) without executing it |

### Write-capable (opt-in via `tool=` argument + `POSTGRES_MCP_ALLOW_WRITE=true`)

| Tool | Description |
|------|-------------|
| `pg_manage_schema` | Schema info, create/alter tables, manage ENUMs |
| `pg_manage_indexes` | List, create, drop, reindex, analyze index usage |
| `pg_manage_constraints` | List, create, and drop constraints and foreign keys |
| `pg_manage_functions` | List, create, and drop functions and procedures |
| `pg_manage_triggers` | List, create, drop, enable/disable triggers |
| `pg_manage_rls` | Row-Level Security policies |
| `pg_manage_users` | User permissions, create/drop/alter users, grant/revoke |
| `pg_execute_mutation` | INSERT / UPDATE / DELETE / UPSERT with parameterized queries |
| `pg_execute_sql` | Arbitrary SQL execution with optional transaction support |

---

## 🧠 Semantic Layer

The four `pg_*_graph` / `pg_*_semantics` / `pg_*_risk` tools build an in-memory knowledge graph of your database at runtime. This gives the LLM a structured map - schemas, tables, columns, foreign keys, inferred relations, risk levels, and business domains - **without executing any query against your data**.

All inferred fields (column semantic roles, table probable types, inferred relations) are clearly tagged so the LLM knows to treat them as hints, not schema facts.

### Optional configuration (`mcp-config.json`)

Place a `mcp-config.json` file beside your `.env` to tune the semantic layer and security limits. All fields are optional - omitting the file applies safe defaults.

```json
{
  "security": {
    "defaultLimit": 100,
    "maxLimit": 1000,
    "blockedSchemas": ["pg_catalog", "information_schema"],
    "blockedTables": [],
    "requireLimit": true
  },
  "semanticLayer": {
    "enabled": true,
    "inferRelationsWithoutForeignKeys": true,
    "inferBusinessEntities": true,
    "sensitiveKeywords": ["password", "secret", "token", "api_key", "ssn", "hash"]
  }
}
```

---

## 🏗️ Architecture

For a detailed view of the communication flow between the MCP client, the proxy, and PostgreSQL - including the full sequence diagram - see [ARCHITECT.md](ARCHITECT.md).

---

## 📄 License

MIT © [Edelcio Molina](https://github.com/edelciomolina)

**2025-09-08 update**: The registry has launched in preview 🎉 ([announcement blog post](https://blog.modelcontextprotocol.io/posts/2025-09-08-mcp-registry-preview/)). While the system is now more stable, this is still a preview release and breaking changes or data resets may occur. A general availability (GA) release will follow later. We'd love your feedback in [GitHub discussions](https://github.com/modelcontextprotocol/registry/discussions/new?category=ideas) or in the [#registry-dev Discord](https://discord.com/channels/1358869848138059966/1369487942862504016) ([joining details here](https://modelcontextprotocol.io/community/communication)).

Current key maintainers:
- **Adam Jones** (Anthropic) [@domdomegg](https://github.com/domdomegg)  
- **Tadas Antanavicius** (PulseMCP) [@tadasant](https://github.com/tadasant)
- **Toby Padilla** (GitHub) [@toby](https://github.com/toby)
- **Radoslav (Rado) Dimitrov** (Stacklok) [@rdimitrov](https://github.com/rdimitrov)

## Contributing

We use multiple channels for collaboration - see [modelcontextprotocol.io/community/communication](https://modelcontextprotocol.io/community/communication).

Often (but not always) ideas flow through this pipeline:

- **[Discord](https://modelcontextprotocol.io/community/communication)** - Real-time community discussions
- **[Discussions](https://github.com/modelcontextprotocol/registry/discussions)** - Propose and discuss product/technical requirements
- **[Issues](https://github.com/modelcontextprotocol/registry/issues)** - Track well-scoped technical work  
- **[Pull Requests](https://github.com/modelcontextprotocol/registry/pulls)** - Contribute work towards issues

### Quick start:

#### Pre-requisites

- **Docker**
- **Go 1.24.x**
- **ko** - Container image builder for Go ([installation instructions](https://ko.build/install/))
- **golangci-lint v2.4.0**

#### Running the server

```bash
# Start full development environment
make dev-compose
```

This starts the registry at [`localhost:8080`](http://localhost:8080) with PostgreSQL. The database uses ephemeral storage and is reset each time you restart the containers, ensuring a clean state for development and testing.

**Note:** The registry uses [ko](https://ko.build) to build container images. The `make dev-compose` command automatically builds the registry image with ko and loads it into your local Docker daemon before starting the services.

By default, the registry seeds from the production API with a filtered subset of servers (to keep startup fast). This ensures your local environment mirrors production behavior and all seed data passes validation. For offline development you can seed from a file without validation with `MCP_REGISTRY_SEED_FROM=data/seed.json MCP_REGISTRY_ENABLE_REGISTRY_VALIDATION=false make dev-compose`.

The setup can be configured with environment variables in [docker-compose.yml](./docker-compose.yml) - see [.env.example](./.env.example) for a reference.

<details>
<summary>Alternative: Running a pre-built Docker image</summary>

Pre-built Docker images are automatically published to GitHub Container Registry. Note that the image does not bundle PostgreSQL, so you need to run your own and point the registry at it via `MCP_REGISTRY_DATABASE_URL` (see [docker-compose.yml](./docker-compose.yml) for a working example):

```bash
# Run latest stable release
docker run -p 8080:8080 ghcr.io/modelcontextprotocol/registry:latest

# Run latest from main branch (continuous deployment)
docker run -p 8080:8080 ghcr.io/modelcontextprotocol/registry:main

# Run specific release version
docker run -p 8080:8080 ghcr.io/modelcontextprotocol/registry:v1.0.0

# Run development build from main branch
docker run -p 8080:8080 ghcr.io/modelcontextprotocol/registry:main-20250906-abc123d
```

**Available tags:** 
- **Releases**: `latest`, `v1.0.0`, `v1.1.0`, etc.
- **Continuous**: `main` (latest main branch build)
- **Development**: `main-<date>-<sha>` (specific commit builds)

</details>

#### Publishing a server

To publish a server, we've built a simple CLI. You can use it with:

```bash
# Build the latest CLI
make publisher

# Use it!
./bin/mcp-publisher --help
```

See [the publisher guide](./docs/modelcontextprotocol-io/quickstart.mdx) for more details.

#### Other commands

```bash
# Run lint, unit tests and integration tests
make check
```

There are also a few more helpful commands for development. Run `make help` to learn more, or look in [Makefile](./Makefile).

<!--
For Claude and other AI tools: Always prefer make targets over custom commands where possible.
-->

## Architecture

### Project Structure

```
├── cmd/                     # Application entry points
│   └── publisher/           # Server publishing tool
├── data/                    # Seed data
├── deploy/                  # Deployment configuration (Pulumi)
├── docs/                    # Documentation
├── internal/                # Private application code
│   ├── api/                 # HTTP handlers and routing
│   ├── auth/                # Authentication (GitHub OAuth, JWT, namespace blocking)
│   ├── config/              # Configuration management
│   ├── database/            # Data persistence (PostgreSQL)
│   ├── service/             # Business logic
│   ├── telemetry/           # Metrics and monitoring
│   └── validators/          # Input validation
├── pkg/                     # Public packages
│   ├── api/                 # API types and structures
│   │   └── v0/              # Version 0 API types
│   └── model/               # Data models for server.json
├── scripts/                 # Development and testing scripts
├── tests/                   # Integration tests
└── tools/                   # CLI tools and utilities
    └── validate-*.sh        # Schema validation tools
```

### Authentication

Publishing supports multiple authentication methods:
- **GitHub OAuth** - For publishing by logging into GitHub
- **GitHub OIDC** - For publishing from GitHub Actions
- **DNS verification** - For proving ownership of a domain and its subdomains
- **HTTP verification** - For proving ownership of a domain

The registry validates namespace ownership when publishing. E.g. to publish...:
- `io.github.domdomegg/my-cool-mcp` you must login to GitHub as `domdomegg`, or be in a GitHub Action on domdomegg's repos
- `me.adamjones/my-cool-mcp` you must prove ownership of `adamjones.me` via DNS or HTTP challenge

## Community Projects

Check out [community projects](docs/community-projects.md) to explore notable registry-related work created by the community.

## More documentation

See the [documentation](./docs) for more details if your question has not been answered here!
