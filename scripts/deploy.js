const { spawnSync } = require("child_process");
const { readFileSync, writeFileSync, unlinkSync } = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const IS_WIN = process.platform === "win32";
const validRelease = /^(patch|minor|major|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

// ---------------------------------------------------------------------------
// deploy — single entry point
// ---------------------------------------------------------------------------
function deploy(release = "minor") {
    if (!isValidRelease(release)) {
        throw new Error(`Invalid release "${release}". Use patch, minor, major or an explicit semver.`);
    }

    run("npm", ["run", "check"]);

    const pkg = readPkg();
    const newVersion = bumpVersion(pkg.version, release);
    const tag = `v${newVersion}`;

    updateServerJson(newVersion);
    run("npm", ["version", release, "--no-git-tag-version"]);
    run("git", ["add", "package.json", "server.json"]);
    run("git", ["commit", "-m", `chore(release): ${tag}`]);
    run("git", ["tag", tag]);

    publishVsce(newVersion);
    publishNpm();
    publishMcpRegistry();

    run("git", ["push", "--follow-tags"]);
}

// ---------------------------------------------------------------------------
// Publish helpers — each is idempotent (safe to re-run)
// ---------------------------------------------------------------------------
function publishVsce(version) {
    const pkg = readPkg();
    const plainName = vsceExtensionName(pkg.name);
    const vsixPath = path.join(ROOT, `${plainName}-${version}.vsix`);

    // Temporarily patch name for vsce (no @scope/ allowed).
    writeFileSync(
        path.join(ROOT, "package.json"),
        JSON.stringify({ ...pkg, name: plainName }, null, 2) + "\n"
    );
    try {
        run(vsceCmd(), ["package", "--out", vsixPath]);
    } finally {
        run("git", ["checkout", "--", "package.json"]);
    }

    // Publish the VSIX. Skip if already published.
    const r = exec(vsceCmd(), ["publish", "--packagePath", vsixPath], { timeout: 120_000 });
    try { unlinkSync(vsixPath); } catch (_) { }
    if (r.status !== 0) {
        const err = r.stderr || "";
        if (/already exists/i.test(err)) {
            log("VS Code Marketplace already has this version — skipping.");
            return;
        }
        if (err) process.stderr.write(err);
        throw new Error(`vsce publish failed (exit ${r.status})`);
    }
}

function publishNpm() {
    const r = exec("npm", ["publish", "--access", "public", "--ignore-scripts"]);
    if (r.status !== 0) {
        const err = r.stderr || "";
        if (/cannot publish over the previously published/i.test(err)) {
            log("npm already has this version — skipping.");
            return;
        }
        if (err) process.stderr.write(err);
        throw new Error(`npm publish failed (exit ${r.status})`);
    }
}

function publishMcpRegistry() {
    try {
        run("npx", ["mcp-publisher", "login", "github"], 120_000);
        run("npx", ["mcp-publisher", "publish"], 60_000);
    } catch (err) {
        log(`mcp-publisher failed (non-fatal): ${err.message}`);
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function readPkg() {
    return JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
}

function bumpVersion(current, release) {
    if (/^\d+\.\d+\.\d+/.test(release)) return release;
    const [major, minor, patch] = current.split(".").map(Number);
    if (release === "major") return `${major + 1}.0.0`;
    if (release === "minor") return `${major}.${minor + 1}.0`;
    return `${major}.${minor}.${patch + 1}`;
}

function updateServerJson(version) {
    const file = path.join(ROOT, "server.json");
    const s = JSON.parse(readFileSync(file, "utf8"));
    s.version = version;
    s.packages[0].version = version;
    writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
}

function isValidRelease(release) {
    return validRelease.test(release);
}

function vsceExtensionName(name) {
    return name.replace(/^@[^/]+\//, "");
}

function vsceCmd() {
    return path.join(ROOT, "node_modules", ".bin", IS_WIN ? "vsce.cmd" : "vsce");
}

function needsShell(cmd) {
    return IS_WIN && (cmd === "npm" || cmd === "npx" || cmd.endsWith(".cmd"));
}

/** Run a command, inherit stdio, throw on failure. */
function run(command, args, timeout) {
    const result = spawnSync(command, args, {
        cwd: ROOT,
        stdio: "inherit",
        shell: needsShell(command),
        timeout
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`Command failed (exit ${result.status}): ${command} ${args.join(" ")}`);
    }
}

/** Run a command, capture stderr, return result object. Does NOT throw. */
function exec(command, args, opts = {}) {
    const result = spawnSync(command, args, {
        cwd: ROOT,
        stdio: ["ignore", "inherit", "pipe"],
        shell: needsShell(command),
        ...opts
    });
    if (result.error) throw result.error;
    return { status: result.status, stderr: result.stderr ? result.stderr.toString() : "" };
}

function log(msg) {
    process.stderr.write(`[deploy] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function main(args = process.argv.slice(2)) {
    try {
        deploy(args[0]);
        return 0;
    } catch (error) {
        console.error(error.message);
        return 1;
    }
}

if (require.main === module) {
    process.exitCode = main();
}

module.exports = { deploy, bumpVersion, updateServerJson, isValidRelease, vsceExtensionName, main, run };
