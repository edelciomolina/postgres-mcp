const { spawnSync } = require("child_process");
const { readFileSync, writeFileSync } = require("fs");
const path = require("path");

const validRelease = /^(patch|minor|major|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

function checkPrerequisites() {
    // Check npm authentication
    const npmWhoami = spawnSync("npm", ["whoami"], { encoding: "utf8", shell: process.platform === "win32" });
    if (npmWhoami.status !== 0) {
        throw new Error(
            "Not logged in to npm. Run:\n\n  npm login\n\nThen retry npm run publish."
        );
    }

    // Check vsce authentication
    const vsceExe = vsceExecutable();
    const vsceWhoami = spawnSync(vsceExe, ["verify-pat", "edelciomolina"], {
        cwd: path.join(__dirname, ".."),
        encoding: "utf8",
        shell: process.platform === "win32"
    });
    if (vsceWhoami.status !== 0) {
        throw new Error(
            "Not logged in to vsce. Run:\n\n  npx vsce login edelciomolina\n\nThen retry npm run publish."
        );
    }
}

function deploy(release = "minor", runCommand = run) {
    if (!isValidRelease(release)) {
        throw new Error(`Invalid release "${release}". Use patch, minor, major or an explicit semver.`);
    }

    const root = path.join(__dirname, "..");

    checkPrerequisites();
    runCommand("npm", ["run", "check"]);

    // Bump version in package.json without git commit/tag (vsce --no-git-tag-version).
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    const newVersion = bumpVersion(pkg.version, release);

    // Update server.json to match.
    updateServerJson(newVersion, root);

    // Publish to VS Code Marketplace — bumps package.json and uploads the VSIX.
    // --no-git-tag-version prevents vsce from running npm version (which does git commit+tag).
    runCommand(vsceExecutable(), ["publish", release, "--no-git-tag-version"]);

    // Re-read package.json after vsce bumped it.
    const pkgPath = path.join(root, "package.json");
    const pkgOriginal = readFileSync(pkgPath, "utf8");

    // Publish the npm package under the scoped name @edelciomolina/postgres-mcp.
    // package.json uses "postgres-mcp" for VS Code, so we patch it temporarily.
    const pkgForNpm = JSON.parse(pkgOriginal);
    pkgForNpm.name = "@edelciomolina/postgres-mcp";
    writeFileSync(pkgPath, JSON.stringify(pkgForNpm, null, 2) + "\n");
    try {
        runCommand("npm", ["publish", "--access", "public", "--ignore-scripts"]);
    } finally {
        // Restore so the working tree matches the committed state.
        writeFileSync(pkgPath, pkgOriginal);
    }

    // Publish to the MCP Registry.
    runCommand("npx", ["mcp-publisher", "login", "github"]);
    runCommand("npx", ["mcp-publisher", "publish"]);

    console.log("\n" + "=".repeat(60));
    console.log(`Published v${newVersion} successfully!`);
    console.log(`  VS Code Marketplace: https://marketplace.visualstudio.com/items?itemName=edelciomolina.postgres-mcp`);
    console.log(`  npm: https://www.npmjs.com/package/@edelciomolina/postgres-mcp`);
    console.log("=".repeat(60));
    console.log("\nGit steps remaining — run manually:");
    console.log(`  git add .`);
    console.log(`  git commit -m "chore(release): v${newVersion}"`);
    console.log(`  git tag v${newVersion}`);
    console.log(`  git push --follow-tags`);
    console.log("");
}

function bumpVersion(current, release) {
    if (/^\d+\.\d+\.\d+/.test(release)) {
        return release;
    }
    const [major, minor, patch] = current.split(".").map(Number);
    if (release === "major") return `${major + 1}.0.0`;
    if (release === "minor") return `${major}.${minor + 1}.0`;
    return `${major}.${minor}.${patch + 1}`;
}

function updateServerJson(version, root) {
    const file = path.join(root, "server.json");
    const s = JSON.parse(readFileSync(file, "utf8"));
    s.version = version;
    s.packages[0].version = version;
    writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
}

function isValidRelease(release) {
    return validRelease.test(release);
}

function vsceExecutable(platform = process.platform) {
    return path.join(
        __dirname,
        "..",
        "node_modules",
        ".bin",
        platform === "win32" ? "vsce.cmd" : "vsce"
    );
}

function run(command, args, spawn = spawnSync, platform = process.platform) {
    const result = spawn(command, args, {
        cwd: path.join(__dirname, ".."),
        stdio: "inherit",
        shell: platform === "win32" && (command === "npm" || command === "npx" || command.endsWith(".cmd"))
    });

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0) {
        throw new Error(`Command failed with exit code ${result.status || 1}: ${command}`);
    }
}

function main(args = process.argv.slice(2), logger = console, deployAction = deploy) {
    try {
        deployAction(args[0]);
        return 0;
    } catch (error) {
        logger.error(error.message);
        return 1;
    }
}

if (require.main === module) {
    process.exitCode = main();
}

module.exports = { deploy, bumpVersion, updateServerJson, isValidRelease, main, run, vsceExecutable };
