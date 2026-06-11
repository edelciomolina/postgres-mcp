const { spawnSync } = require("child_process");
const { readFileSync, writeFileSync } = require("fs");
const path = require("path");

const validRelease = /^(patch|minor|major|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

function deploy(release = "minor", runCommand = run) {
    if (!isValidRelease(release)) {
        throw new Error(`Invalid release "${release}". Use patch, minor, major or an explicit semver.`);
    }

    const root = path.join(__dirname, "..");
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    const newVersion = bumpVersion(pkg.version, release);

    runCommand("npm", ["run", "check"]);

    // Update server.json before vsce runs so that `npm version` (git commit -a)
    // picks up both package.json and server.json in the same release commit.
    updateServerJson(newVersion, root);

    // Publish to VS Code Marketplace — bumps package.json, creates the release
    // commit and tag, then uploads the VSIX.
    runCommand(vsceExecutable(), ["publish", release, "--message", "chore(release): %s"]);

    // Publish the npm package under the scoped name @edelciomolina/postgres-mcp.
    // package.json uses "postgres-mcp" for VS Code, so we patch it temporarily.
    const pkgPath = path.join(root, "package.json");
    const pkgOriginal = readFileSync(pkgPath, "utf8");
    const pkgForNpm = JSON.parse(pkgOriginal);
    pkgForNpm.name = "@edelciomolina/postgres-mcp";
    writeFileSync(pkgPath, JSON.stringify(pkgForNpm, null, 2) + "\n");
    try {
        runCommand("npm", ["publish", "--access", "public"]);
    } finally {
        // Restore so the working tree matches the committed state before git push.
        writeFileSync(pkgPath, pkgOriginal);
    }

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

module.exports = { deploy, bumpVersion, updateServerJson, isValidRelease, main, run, vsceExecutable };
