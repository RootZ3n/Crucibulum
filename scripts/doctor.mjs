/**
 * Crucible — environment doctor.
 *
 * Read-only beginner diagnostic. Reports node/npm versions, repo state,
 * required directories, env keys, and whether the build artifacts exist.
 * Never mutates user data; never prints secret values.
 */
import { existsSync, statSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let problems = 0;
let warnings = 0;

function ok(msg) {
  console.log(`  ok    ${msg}`);
}
function warn(msg) {
  warnings++;
  console.log(`  warn  ${msg}`);
}
function fail(msg) {
  problems++;
  console.log(`  FAIL  ${msg}`);
}

function section(title) {
  console.log(`\n${title}`);
}

function readVersion(cmd, args) {
  try {
    const result = spawnSync(cmd, args, { encoding: "utf-8" });
    if (result.status === 0) return result.stdout.trim();
  } catch { /* ignore */ }
  return null;
}

console.log("Crucible doctor — environment audit (read-only).\n");

section("Runtime");
const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
if (nodeMajor >= 20) ok(`Node ${process.versions.node}`);
else fail(`Node ${process.versions.node} is below the required >=20`);

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const npmVersion = readVersion(npmCmd, ["--version"]);
if (npmVersion) {
  const npmMajor = parseInt(npmVersion.split(".")[0], 10);
  if (npmMajor >= 10) ok(`npm ${npmVersion}`);
  else warn(`npm ${npmVersion} is below the recommended >=10`);
} else {
  fail("npm not found on PATH");
}
ok(`Platform: ${process.platform} (${process.arch})`);

section("Repository");
const pkgPath = join(root, "package.json");
if (existsSync(pkgPath)) ok("package.json present");
else fail("package.json missing — are you in the Crucible repo?");

const nodeModules = join(root, "node_modules");
if (existsSync(nodeModules)) ok("node_modules present (dependencies installed)");
else fail("node_modules missing — run `npm ci`");

const distServer = join(root, "dist", "server", "api.js");
if (existsSync(distServer)) ok("dist/server/api.js built");
else warn("dist/server/api.js missing — run `npm run build`");

const uiIndex = join(root, "ui", "index.html");
if (existsSync(uiIndex)) ok("ui/index.html present");
else warn("ui/index.html missing — UI will fall back to placeholder");

section("State directories (auto-created on first run)");
for (const dir of ["runs", "state"]) {
  const p = join(root, dir);
  if (existsSync(p)) {
    try {
      const count = readdirSync(p).length;
      ok(`${dir}/ exists (${count} entries)`);
    } catch {
      warn(`${dir}/ exists but cannot be listed`);
    }
  } else {
    ok(`${dir}/ not yet created (will be created on first run)`);
  }
}

section("Environment");
const envKeys = [
  ["CRUCIBLE_HOST", "default 127.0.0.1"],
  ["CRUCIBLE_PORT", "default 18795"],
  ["CRUCIBLE_HMAC_KEY", "required for verified rankings"],
  ["CRUCIBLE_API_TOKEN", "required for non-loopback access"],
  ["CRUCIBLE_ALLOW_LOCAL", "default true"],
];
for (const [key, hint] of envKeys) {
  const value = process.env[key];
  if (value && value.length > 0) {
    ok(`${key} is set (${hint})`);
  } else if (key === "CRUCIBLE_HMAC_KEY") {
    warn(`${key} is not set — bundles will not be eligible for public ranking (${hint})`);
  } else {
    ok(`${key} is unset (${hint})`);
  }
}

section("Disk");
try {
  const stats = statSync(root);
  ok(`Repo path: ${root} (mode ${(stats.mode & 0o777).toString(8)})`);
} catch (err) {
  fail(`Cannot stat repo root: ${String(err)}`);
}

console.log("");
if (problems > 0) {
  console.log(`Doctor: ${problems} blocker(s), ${warnings} warning(s).`);
  process.exit(1);
} else if (warnings > 0) {
  console.log(`Doctor: 0 blockers, ${warnings} warning(s). Crucible should run; see warnings above.`);
  process.exit(0);
} else {
  console.log("Doctor: all checks passed.");
  process.exit(0);
}
