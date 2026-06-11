# Publishing

## Authentication

Before the first deployment:

1. Create or confirm the `edelciomolina` publisher in the
   [Visual Studio Marketplace management portal](https://marketplace.visualstudio.com/manage).
2. Create an Azure DevOps Personal Access Token with the
   **Marketplace > Manage** permission.
3. Authenticate `vsce`:

```powershell
npx vsce login edelciomolina
```

The token can also be provided through the `VSCE_PAT` environment variable:

```powershell
$env:VSCE_PAT = "your-token"
```

The `publisher` value in `package.json` must exactly match the Marketplace
publisher ID.

## MCP Registry authentication

The deploy script also publishes to the
[MCP Registry](https://registry.modelcontextprotocol.io/) via `mcp-publisher`.
Authenticate once before running a release:

```powershell
npx mcp-publisher login github
```

## Deployment

Run deployments with a clean Git working tree:

```powershell
npm run publish
npm run publish -- patch
npm run publish -- major
npm run publish -- 1.2.3
```

The publish command:

1. Runs `npm run check` (build + tests).
2. Updates `server.json` with the new version so it is included in the release
   commit.
3. Publishes the extension to the Visual Studio Marketplace, bumping the
   version in `package.json`, creating the release commit and Git tag.
4. Publishes the npm package (`@edelciomolina/postgres-mcp`).
5. Publishes to the MCP Registry.
6. Pushes the release commit and tag to GitHub.

## Status

Check the current publication status on the MCP Registry:

```powershell
npm run status:mcp
```
