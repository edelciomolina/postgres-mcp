import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// Configuration shape
// ---------------------------------------------------------------------------

export interface McpConfig {
  security: {
    defaultLimit: number;
    maxLimit: number;
    blockedSchemas: string[];
    blockedTables: string[];
    requireLimit: boolean;
  };
  semanticLayer: {
    enabled: boolean;
    inferRelationsWithoutForeignKeys: boolean;
    inferBusinessEntities: boolean;
    sensitiveKeywords: string[];
  };
}

// ---------------------------------------------------------------------------
// Defaults - applied when mcp-config.json is absent or fields are missing
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: McpConfig = {
  security: {
    defaultLimit: 100,
    maxLimit: 1000,
    blockedSchemas: ["pg_catalog", "information_schema"],
    blockedTables: [],
    requireLimit: true
  },
  semanticLayer: {
    enabled: true,
    inferRelationsWithoutForeignKeys: true,
    inferBusinessEntities: true,
    sensitiveKeywords: [
      "password",
      "passwd",
      "pass",
      "secret",
      "token",
      "api_key",
      "apikey",
      "credential",
      "credit",
      "ssn",
      "private_key",
      "hash",
      "salt",
      "auth",
      "otp",
      "pin"
    ]
  }
};

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load mcp-config.json from the same directory as the .env file (or cwd).
 * Falls back to DEFAULT_CONFIG for any missing field.
 * Never throws - configuration errors fall back to safe defaults.
 */
export function loadConfig(envDir: string): McpConfig {
  const candidates = [
    resolve(envDir, "mcp-config.json"),
    resolve(process.cwd(), "mcp-config.json")
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const raw = JSON.parse(
        readFileSync(candidate, "utf8")
      ) as Partial<McpConfig>;
      return mergeWithDefaults(raw);
    } catch {
      process.stderr.write(
        `WARNING: Could not parse mcp-config.json at ${candidate}, using defaults.\n`
      );
    }
  }

  return DEFAULT_CONFIG;
}

function mergeWithDefaults(partial: Partial<McpConfig>): McpConfig {
  return {
    security: {
      ...DEFAULT_CONFIG.security,
      ...(partial.security ?? {})
    },
    semanticLayer: {
      ...DEFAULT_CONFIG.semanticLayer,
      ...(partial.semanticLayer ?? {})
    }
  };
}
