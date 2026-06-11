import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
  const didChangeEmitter = new vscode.EventEmitter<void>();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("postgresMcp")) {
        didChangeEmitter.fire();
      }
    })
  );

  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider("postgres-mcp", {
      onDidChangeMcpServerDefinitions: didChangeEmitter.event,
      async provideMcpServerDefinitions() {
        const cfg = vscode.workspace.getConfiguration("postgresMcp");
        const env: Record<string, string> = {};

        const mappings: ReadonlyArray<[string, string]> = [
          ["keyHost", "MCP_KEY_HOST"],
          ["keyPort", "MCP_KEY_PORT"],
          ["keyName", "MCP_KEY_NAME"],
          ["keyUser", "MCP_KEY_USER"],
          ["keyPass", "MCP_KEY_PASS"],
          ["keySslMode", "MCP_KEY_SSLMODE"]
        ];

        for (const [setting, envVar] of mappings) {
          const value = cfg.get<string>(setting);
          if (value) {
            env[envVar] = value;
          }
        }

        return [
          new vscode.McpStdioServerDefinition(
            "Postgres MCP",
            "npx",
            ["-y", "postgres-mcp"],
            env
          )
        ];
      }
    })
  );
}

export function deactivate(): void {}
