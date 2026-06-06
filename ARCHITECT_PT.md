> 🌐 [English](ARCHITECT.md) | **Português**

# Arquitetura

Este documento descreve o fluxo de comunicação entre um cliente MCP e o PostgreSQL ao usar o `@edelciomolina/postgres-mcp`.

## Visão Geral

O `@edelciomolina/postgres-mcp` é um **proxy wrapper** que fica entre o cliente MCP e o `@henkey/postgres-mcp-server` subjacente. Ele adiciona três responsabilidades que o servidor filho não trata:

| Responsabilidade | Quando |
|---|---|
| Resolução de credenciais do `.env` com mapeamento configurável de chaves | Inicialização |
| Injeção de instruções no handshake MCP | Resposta do `initialize` |
| Proteção contra consultas multi-statement | Toda chamada a `pg_execute_query` |

---

## Fluxo de Comunicação

```mermaid
sequenceDiagram
    actor Client as Cliente MCP<br/>(VS Code / Copilot)
    participant Proxy as postgres-mcp<br/>(Proxy Wrapper)
    participant Child as @henkey/postgres-mcp-server<br/>(Processo Filho)
    participant PG as PostgreSQL

    %% ── Boot ──────────────────────────────────────────────────────────
    note over Proxy: Inicialização
    Proxy->>Proxy: findEnvFile(cwd)
    Proxy->>Proxy: loadEnvFile(path)
    Proxy->>Proxy: resolveCredential × 6<br/>MCP_KEY_* → valor do .env
    Proxy->>Proxy: buildConnectionString<br/>(URL-encode user + pass)
    Proxy->>Proxy: writeFileSync(tempFile)<br/>{ enabledTools: DEFAULT_READONLY_TOOLS }
    Proxy->>Child: spawn()<br/>env: POSTGRES_CONNECTION_STRING

    %% ── Handshake ─────────────────────────────────────────────────────
    note over Client,PG: Handshake
    Client->>Proxy: initialize { clientInfo, capabilities }
    Proxy->>Child: initialize (passthrough)
    Child-->>Proxy: result { serverInfo, capabilities }
    note over Proxy: Detecta result.serverInfo<br/>→ injeta MCP_INSTRUCTIONS
    Proxy-->>Client: result { serverInfo, capabilities,<br/>instructions: MCP_INSTRUCTIONS }

    %% ── Schema check before query ─────────────────────────────────────
    note over Client,PG: Fluxo correto - inspecionar schema antes de consultar
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
    note over Client,PG: Fluxo bloqueado - multi-statement rejeitado pelo proxy
    Client->>Proxy: tools/call pg_execute_query<br/>{ query: "SELECT COUNT(*) FROM users#59;<br/>  SELECT * FROM users" }
    Proxy->>Proxy: hasMultipleStatements(query)<br/>→ true 🚫
    note over Proxy: O processo filho nunca<br/>recebe esta mensagem
    Proxy-->>Client: result { isError: true,<br/>"Consultas multi-statement não são permitidas.<br/>Divida em chamadas separadas." }

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

## Decisões de design

### 1. Proxy ao invés de fork
O wrapper inicializa o processo filho com `stdio: ["pipe", "pipe", "inherit"]`, dando controle total sobre stdin/stdout enquanto deixa o stderr fluir diretamente para o terminal. Isso permite a interceptação sem reimplementar o protocolo MCP.

### 2. Instruções injetadas no handshake
A resposta do `initialize` é a única mensagem que o proxy **modifica**. Ele acrescenta `MCP_INSTRUCTIONS` em `result.instructions`, que o cliente lê uma vez na inicialização. Isso orienta o modelo a:
- Sempre chamar `pg_manage_schema` antes de referenciar nomes de colunas
- Nunca enviar múltiplas instruções SQL em uma única chamada `pg_execute_query`
- Usar `operation="count"` para contagem de linhas

### 3. Proteção contra multi-statement no caminho crítico
Toda chamada `tools/call` para `pg_execute_query` é inspecionada antes de ser encaminhada. Se `hasMultipleStatements()` retornar `true`, o proxy retorna uma resposta de erro MCP diretamente - o processo filho nunca é envolvido. Literais de string contendo `;` são removidos antes da verificação para evitar falsos positivos (ex.: `WHERE name = 'a;b'`).

### 4. Isolamento de credenciais
As credenciais nunca aparecem nos argumentos ou configurações de ferramentas MCP. Elas são resolvidas na inicialização a partir de um arquivo `.env`, codificadas em uma string de conexão e injetadas como `POSTGRES_CONNECTION_STRING` no ambiente do processo filho. Os nomes das chaves podem ser remapeados via variáveis de ambiente `MCP_KEY_*`, permitindo que o mesmo `.env` sirva múltiplos serviços sem duplicação.

### 5. Somente leitura por padrão
`DEFAULT_READONLY_TOOLS` omite todas as ferramentas de escrita/DDL (`pg_execute_mutation`, `pg_execute_sql`). O acesso de escrita requer a passagem explícita de argumentos `tool=<nome>` na inicialização.
