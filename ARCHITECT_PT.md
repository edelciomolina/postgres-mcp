> 🌐 [English](ARCHITECT.md) | **Português**

# Arquitetura

Este documento descreve o fluxo de comunicação entre um cliente MCP e o PostgreSQL ao usar o `@edelciomolina/postgres-mcp`.

## Visão Geral

O `@edelciomolina/postgres-mcp` é um **servidor MCP nativo** construído com [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) e [`pg`](https://www.npmjs.com/package/pg) (node-postgres). Não há processo filho ou proxy NDJSON — o protocolo MCP e a conectividade com o banco de dados são tratados diretamente.

| Responsabilidade | Quando |
|---|---|
| Resolução de credenciais do `.env` com mapeamento configurável de chaves | Inicialização |
| Instruções entregues ao cliente | Resposta do `initialize` (via opção do construtor do SDK) |
| Proteção contra multi-statement e operações de escrita | Dentro do handler `pg_execute_query` |
| Filtragem de ferramentas | Registro seletivo de ferramentas na inicialização |

---

## Fluxo de Comunicação

```mermaid
sequenceDiagram
    actor Client as Cliente MCP<br/>(VS Code / Copilot)
    participant Server as postgres-mcp<br/>(McpServer)
    participant Pool as pg.Pool
    participant PG as PostgreSQL

    %% ── Boot ──────────────────────────────────────────────────────────
    note over Server: Inicialização
    Server->>Server: findEnvFile(cwd)
    Server->>Server: loadEnvFile(path)
    Server->>Server: resolveCredential × 6<br/>MCP_KEY_* → valor do .env
    Server->>Server: buildConnectionString<br/>(URL-encode user + pass)
    Server->>Pool: new Pool({ connectionString })
    Server->>Server: registerTools(server, pool, enabledTools)
    Server->>Server: connect(StdioServerTransport)

    %% ── Handshake ─────────────────────────────────────────────────────
    note over Client,PG: Handshake
    Client->>Server: initialize { clientInfo, capabilities }
    note over Server: SDK injeta MCP_INSTRUCTIONS<br/>a partir das opções do construtor
    Server-->>Client: result { serverInfo, capabilities,<br/>instructions: MCP_INSTRUCTIONS }

    %% ── Schema check before query ─────────────────────────────────────
    note over Client,PG: Fluxo correto - inspecionar schema antes de consultar
    Client->>Server: tools/call pg_manage_schema<br/>{ operation: "get_info", tableName: "users" }
    Server->>Pool: pool.connect()
    Pool->>PG: query information_schema.columns
    PG-->>Pool: colunas, tipos, constraints
    Pool-->>Server: linhas de resultado
    Server-->>Client: result { columns: [uid, display_name, ...] }

    %% ── Valid single query ────────────────────────────────────────────
    Client->>Server: tools/call pg_execute_query<br/>{ operation: "select",<br/>  query: "SELECT uid, display_name FROM users" }
    Server->>Server: hasMultipleStatements(query) → false ✅
    Server->>Server: isWriteOperation(query) → false ✅
    Server->>Pool: pool.connect()
    Pool->>PG: SELECT uid, display_name FROM users
    PG-->>Pool: rows[]
    Pool-->>Server: linhas de resultado
    Server-->>Client: result { rowCount, rows }

    %% ── Multi-statement blocked ───────────────────────────────────────
    note over Client,PG: Fluxo bloqueado - multi-statement rejeitado pelo handler
    Client->>Server: tools/call pg_execute_query<br/>{ query: "SELECT COUNT(*) FROM users#59;<br/>  SELECT * FROM users" }
    Server->>Server: hasMultipleStatements(query) → true 🚫
    note over Server: Banco de dados nunca é consultado
    Server-->>Client: result { isError: true,<br/>"Consultas multi-statement não são permitidas.<br/>Divida em chamadas separadas." }

    %% ── Unregistered tool ─────────────────────────────────────────────
    note over Client,PG: Fluxo bloqueado - ferramenta de escrita não registrada
    Client->>Server: tools/call pg_execute_mutation { ... }
    note over Server: Ferramenta nunca foi registrada<br/>(não está em enabledTools)
    Server-->>Client: error "Tool not found"
```

---

## Decisões de design

### 1. Servidor MCP nativo
O servidor usa a classe `McpServer` do `@modelcontextprotocol/sdk` com `StdioServerTransport`. Não há processo filho ou proxy NDJSON. O protocolo MCP é tratado nativamente pelo SDK, mantendo o código simples e eliminando uma dependência de execução.

### 2. Instruções via construtor do SDK
`MCP_INSTRUCTIONS` é passado para `new McpServer({ name, version }, { instructions })`. O SDK o injeta na resposta do `initialize` automaticamente — sem necessidade de interceptar mensagens ou fazer patch manual em JSON.

### 3. Guards dentro dos handlers das tools
As verificações de multi-statement (`hasMultipleStatements`) e de operação de escrita (`isWriteOperation`) ficam dentro da função handler de `pg_execute_query`. Se alguma delas falhar, o handler retorna um resultado de erro imediatamente — o banco de dados nunca é consultado e não é necessária nenhuma camada extra de interceptação.

### 4. Registro seletivo de ferramentas
Apenas as ferramentas presentes em `enabledTools` são registradas no `McpServer` durante a inicialização. Chamar uma ferramenta não registrada retorna o erro padrão "tool not found" do SDK. Não há guard de ferramentas desabilitadas em tempo de execução; a filtragem ocorre uma única vez, na inicialização.

### 5. Isolamento de credenciais
As credenciais nunca aparecem nos argumentos das tools MCP ou nas mensagens MCP. Elas são resolvidas na inicialização a partir de um arquivo `.env`, codificadas em URL em uma connection string e passadas para uma instância de `pg.Pool`. Os nomes das chaves podem ser remapeados via variáveis de ambiente `MCP_KEY_*`, permitindo que o mesmo `.env` sirva múltiplos serviços sem duplicação.

### 6. Somente leitura por padrão
`DEFAULT_READONLY_TOOLS` omite as ferramentas de escrita (`pg_execute_mutation`, `pg_execute_sql`). O acesso de escrita requer a passagem explícita de argumentos `tool=<nome>` na inicialização.
