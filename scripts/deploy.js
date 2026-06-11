const { spawnSync } = require("child_process");
const { readFileSync, writeFileSync } = require("fs");
const path = require("path");

const validRelease = /^(patch|minor|major|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

function deploy(release = "minor", runCommand = run) {
    if (!isValidRelease(release)) {
        throw new Error(`Invalid release "${release}". Use patch, minor, major or an explicit semver.`);
    }

    const root = path.join(__dirname, "..");
    const pkgPath = path.join(root, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const newVersion = bumpVersion(pkg.version, release);

    runCommand("npm", ["run", "check"]);

    // Update server.json before vsce runs so that `npm version` (git commit -a)
    // picks up both package.json and server.json in the same release commit.
    updateServerJson(newVersion, root);

    // vsce requires `name` to be a plain identifier (no @scope/ prefix).
    // Temporarily patch package.json for the vsce publish step, then restore it.
    const vsceNamePkg = { ...pkg, name: vsceExtensionName(pkg.name) };
    writeFileSync(pkgPath, JSON.stringify(vsceNamePkg, null, 2) + "\n");
    try {
        // Publish to VS Code Marketplace — bumps package.json, creates the release
        // commit and tag, then uploads the VSIX.
        runCommand(vsceExecutable(), ["publish", release, "--message", "chore(release): %s"]);
    } finally {
        // Restore scoped name so npm publish and git history are correct.
        const updatedPkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        updatedPkg.name = pkg.name;
        writeFileSync(pkgPath, JSON.stringify(updatedPkg, null, 2) + "\n");
    }

    // Publish the npm package (uses the version already bumped by vsce above).
    runCommand("npm", ["publish", "--access", "public"]);

    // Publish to the MCP Registry.
    runCommand("npx", ["mcp-publisher", "login", "github"]);
    runCommand("npx", ["mcp-publisher", "publish"]);

    // Push commits and tags to GitHub.
    runCommand("git", ["push", "--follow-tags"]);
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

/**
 * vsce requires `name` to be a plain identifier with no @scope/ prefix.
 * Strips the scope if present: "@edelciomolina/postgres-mcp" → "postgres-mcp".
 */
function vsceExtensionName(name) {
    return name.replace(/^@[^/]+\//, "");
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
        shell: platform === "win32" && (command === "npm" || command.endsWith(".cmd"))
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

module.exports = { deploy, bumpVersion, updateServerJson, isValidRelease, vsceExtensionName, main, run, vsceExecutable };
