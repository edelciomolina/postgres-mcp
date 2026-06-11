> 🌐 [English](README.md) | **Português**

<table border="0" cellspacing="0" cellpadding="0">
  <tr>
    <td width="110">
      <img src="https://raw.githubusercontent.com/edelciomolina/postgres-mcp/main/icon.png" width="96" alt="Ícone do Postgres MCP"/>
    </td>
    <td>
      <h1>Postgres MCP</h1>
      <p>🔌 Servidor MCP nativo para PostgreSQL - lê credenciais do <code>.env</code> em tempo de execução com mapeamento de chaves flexível, seleção configurável de ferramentas e <strong>modo somente leitura por padrão</strong>.</p>
      <a href="https://www.npmjs.com/package/@edelciomolina/postgres-mcp"><img src="https://img.shields.io/npm/v/@edelciomolina/postgres-mcp" alt="versão npm"/></a>
      <a href="https://www.npmjs.com/package/@edelciomolina/postgres-mcp"><img src="https://img.shields.io/npm/l/%40edelciomolina%2Fpostgres-mcp" alt="licença"/></a>
      <a href="https://github.com/edelciomolina/postgres-mcp/actions/workflows/ci.yml"><img src="https://github.com/edelciomolina/postgres-mcp/actions/workflows/ci.yml/badge.svg" alt="CI"/></a>
    </td>
  </tr>
</table>

---

## ✨ O que faz

Este é um **servidor MCP nativo** construído diretamente com [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) e [`pg`](https://www.npmjs.com/package/pg) (node-postgres). Ele oferece:

- 🔐 **Resolução de credenciais em tempo de execução** - lê as credenciais do banco de dados do seu arquivo `.env` na inicialização, sem armazenar segredos no `mcp.json`
- 🗝️ **Mapeamento de chaves flexível** - use quaisquer nomes de variáveis no `.env`; indique ao servidor quais usar via `env` no `mcp.json`
- 🎯 **Seleção explícita de ferramentas** - passe argumentos `tool=<nome>` para escolher exatamente quais ferramentas MCP expor
- 🛡️ **Somente leitura por padrão** - se nenhuma ferramenta for especificada, apenas ferramentas seguras de introspecção são habilitadas (sem escrita, sem execução de SQL arbitrário)

---

## 📋 Requisitos

- ⚙️ Node.js >= 18
- 📄 Um arquivo `.env` com as credenciais do banco de dados (em qualquer lugar na árvore do projeto - veja [Descoberta do .env](#-descoberta-do-arquivo-env))

---

## 🚀 Instalação

Existem duas formas de usar este pacote. Escolha a que melhor se adapta ao seu fluxo de trabalho.

### Opção 1 - Sem instalação (via `npx`, recomendado para início rápido)

Sem necessidade de instalação. O `npx` baixa e executa o pacote sob demanda. Adicione `-y` como primeiro argumento para pular a confirmação.

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

Isso inicia o servidor com o **conjunto padrão de ferramentas somente leitura** - não são necessários argumentos `tool=`. Para habilitar ferramentas com capacidade de escrita, veja [Ferramentas com escrita](#com-capacidade-de-escrita-opt-in-via-argumento-tool).

> 💡 **Usando Supabase, Neon, Railway ou outra plataforma que fornece apenas uma connection string?** Use `MCP_KEY_URL` apontando para `DATABASE_URL` (ou o nome da variável que a plataforma usa). O servidor priorizará a URL e ignorará as variáveis individuais. Veja [Conexão via URL](#-conexão-via-url-database_url).

---

### Opção 2 - Instalar via VS Code (marketplace de extensões MCP)

O VS Code suporta descoberta e instalação de servidores MCP diretamente no editor, sem usar o terminal.

1. Abra a **Paleta de Comandos** (<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> no Mac / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> no Windows/Linux)
2. Execute **`MCP: Add Server`**
3. Escolha **"Browser MCP Servers"** (ou **"From registry"**, dependendo da sua versão do VS Code)
4. Procure por **`postgres-mcp`** ou **`edelciomolina`**
5. Selecione **Postgres MCP** e siga as instruções - o VS Code adicionará a entrada ao seu `mcp.json` automaticamente

> 💡 Você também pode abrir o painel de Servidores MCP via **ícone do Copilot chat → Gerenciar Servidores MCP** para navegar, habilitar ou desabilitar servidores a qualquer momento.

Após instalar, edite a entrada gerada em `.vscode/mcp.json` para adicionar seus argumentos `tool=` e mapeamentos de chaves `env` conforme mostrado na seção [Uso](#-uso-no-vs-code-mcpjson) abaixo.

---

## 🚀 Uso no VS Code (`mcp.json`)

**Somente leitura (padrão - sem argumentos `tool=` necessários):**

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

**Com ferramentas de escrita (opt-in explícito necessário):**

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

> ⚠️ Ferramentas com capacidade de escrita exigem `POSTGRES_MCP_ALLOW_WRITE=true` no `env`. Sem isso, o servidor encerra na inicialização.

O arquivo `.env` correspondente na raiz do seu projeto:

```env
DB_HOST=db.seu-projeto.supabase.co
DB_PORT=5432
DB_NAME=postgres
DB_SSLMODE=require
DB_USER=readonly_user
DB_PASS=sua_senha
```

---

## ⚙️ Como funciona a configuração do `mcp.json`

### 🗝️ `env` - mapeamento de chaves de credenciais

O bloco `env` **não** contém as credenciais reais. Ele mapeia cada `MCP_KEY_*` para o nome da variável no seu arquivo `.env`.

| Chave em `env`    | Aponta para variável `.env` | Exemplo de valor         |
|-------------------|-----------------------------|--------------------------|
| `MCP_KEY_URL`     | `DATABASE_URL`              | `postgresql://user:pass@host:5432/db?sslmode=require` |
| `MCP_KEY_HOST`    | `DB_HOST`                   | `db.exemplo.supabase.co` |
| `MCP_KEY_PORT`    | `DB_PORT`                   | `5432`                   |
| `MCP_KEY_NAME`    | `DB_NAME`                   | `postgres`               |
| `MCP_KEY_SSLMODE` | `DB_SSLMODE`                | `require`                |
| `MCP_KEY_USER`    | `DB_USER`                   | `readonly_user`          |
| `MCP_KEY_PASS`    | `DB_PASS`                   | `segredo`                |

> **Prioridade:** quando `MCP_KEY_URL` (ou `DATABASE_URL`) está presente, o servidor usa a URL diretamente e **ignora** as demais chaves individuais.

Essa indireção permite que você use **qualquer nome de variável** no seu `.env` - útil quando compartilha um `.env` entre múltiplos serviços com convenções de nomenclatura diferentes.

### 🔧 `args` - seleção de ferramentas via prefixo `tool=`

Cada ferramenta MCP habilitada é declarada como um argumento separado no formato `tool=<nome>`:

```json
"args": [
  "-y",
  "@edelciomolina/postgres-mcp",
  "tool=pg_manage_schema",
  "tool=pg_manage_indexes"
]
```

Isso torna a lista de ferramentas **explícita e auditável** diretamente no `mcp.json` - sem arquivos de configuração ocultos. 🔍

---

## � Conexão via URL (`DATABASE_URL`)

Além das credenciais individuais, você pode fornecer uma **connection string completa** - o formato padrão em plataformas como Supabase, Neon e Railway.

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

A variável mapeada por `MCP_KEY_URL` tem **prioridade** sobre as demais chaves (`MCP_KEY_HOST`, `MCP_KEY_PORT`, etc.). Se a URL estiver presente, as outras variáveis são ignoradas.

Caso a plataforma use um nome diferente (ex.: `DB_URL`), basta ajustar o mapeamento:
```json
"MCP_KEY_URL": "DB_URL"
```

---

## �🛡️ Por que somente leitura é o padrão

Se você omitir todos os argumentos `tool=`, o servidor inicia com um **conjunto somente leitura curado** - todas as ferramentas que podem recuperar, analisar ou explicar dados, mas nada que possa modificá-los.

**✅ Incluídas nos padrões (somente leitura):**

```
pg_execute_query    pg_manage_query    pg_inspect_schema
pg_get_setup_instructions              pg_analyze_database
pg_monitor_database                    pg_debug_database
```

> 💡 `pg_execute_query` rejeita `INSERT`, `UPDATE`, `DELETE`, DDL, `ANALYZE`, `VACUUM`, `EXPLAIN ANALYZE` e outros comandos de escrita/manutenção antes de o banco de dados ser consultado.

> 💡 `pg_inspect_schema` fornece introspecção de schema somente leitura (`get_info`, `get_enums`). Para operações DDL, use `pg_manage_schema` com opt-in explícito.

**⚠️ Excluídas dos padrões - exigem argumento `tool=` E `POSTGRES_MCP_ALLOW_WRITE=true`:**

| Ferramenta | Operações |
|------------|----------|
| `pg_manage_schema` | CREATE TABLE, ALTER TABLE, CREATE TYPE |
| `pg_manage_indexes` | CREATE INDEX, DROP INDEX, REINDEX |
| `pg_manage_constraints` | ADD CONSTRAINT, DROP CONSTRAINT |
| `pg_manage_functions` | CREATE FUNCTION, DROP FUNCTION |
| `pg_manage_triggers` | CREATE TRIGGER, DROP TRIGGER, habilitar/desabilitar |
| `pg_manage_rls` | ENABLE/DISABLE RLS, CREATE/ALTER/DROP POLICY |
| `pg_manage_users` | CREATE/DROP/ALTER USER, GRANT, REVOKE |
| `pg_execute_mutation` | INSERT / UPDATE / DELETE / UPSERT |
| `pg_execute_sql` | SQL arbitrário com suporte a transações |

---

## 📍 Descoberta do arquivo `.env`

O servidor resolve o arquivo `.env` nesta ordem:

1. **Argumento `env-file=<caminho>`** - caminho explícito relativo ao `cwd`; tem prioridade sobre tudo
2. **Busca ascendente** - a partir do `cwd`, pesquisa cada diretório pai até encontrar um `.env` ou atingir a raiz do sistema de arquivos

Se nenhum `.env` for encontrado, o servidor encerra com uma mensagem de erro clara.

### Monorepos e subpastas

Quando o VS Code inicia o processo MCP, o `cwd` é tipicamente a raiz do workspace. Se o seu `.env` estiver em uma subpasta (ex.: `functions/.env`), use `env-file=` para apontá-lo explicitamente:

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

> 💡 O comportamento de busca ascendente trata o caso comum automaticamente. Use `env-file=` quando precisar de controle explícito (CI, monorepos, bind-mounts no Docker).

---

## 🧰 Ferramentas disponíveis

### Somente leitura (habilitadas por padrão)

| Ferramenta | Descrição |
|------------|----------|
| `pg_execute_query` | SELECT / COUNT / EXISTS com guards de escrita e multi-statement |
| `pg_manage_query` | Planos EXPLAIN, análise de queries lentas, `pg_stat_statements` |
| `pg_inspect_schema` | Info de schema e tipos ENUM (introspecção somente leitura) |
| `pg_get_setup_instructions` | Instruções de configuração por plataforma |
| `pg_analyze_database` | Análise de performance, configuração e armazenamento |
| `pg_monitor_database` | Monitoramento em tempo real de conexões, queries, locks e replicação |
| `pg_debug_database` | Diagnosticar conexões, locks, performance e replicação |

### Com capacidade de escrita (opt-in via argumento `tool=` + `POSTGRES_MCP_ALLOW_WRITE=true`)

| Ferramenta | Descrição |
|------------|----------|
| `pg_manage_schema` | Info de schema, criar/alterar tabelas, gerenciar ENUMs |
| `pg_manage_indexes` | Listar, criar, remover, reindexar, analisar uso de índices |
| `pg_manage_constraints` | Listar, criar e remover constraints e chaves estrangeiras |
| `pg_manage_functions` | Listar, criar e remover funções e procedures |
| `pg_manage_triggers` | Listar, criar, remover, habilitar/desabilitar triggers |
| `pg_manage_rls` | Políticas de Row-Level Security |
| `pg_manage_users` | Permissões de usuários, criar/remover/alterar usuários, grant/revoke |
| `pg_execute_mutation` | INSERT / UPDATE / DELETE / UPSERT com queries parametrizadas |
| `pg_execute_sql` | Execução de SQL arbitrário com suporte opcional a transações |

---

## 🏗️ Arquitetura

Para uma visão detalhada do fluxo de comunicação entre o cliente MCP, o proxy e o PostgreSQL - incluindo o diagrama de sequência completo - consulte [ARCHITECT_PT.md](ARCHITECT_PT.md).

---

## 📄 Licença

MIT © [Edelcio Molina](https://github.com/edelciomolina)
