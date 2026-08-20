#!/usr/bin/env node
/**
 * Luak — pin Bokahli's published contract, verbatim.
 *
 * Luak consumes Bokahli over HTTP and imports nothing from it at runtime: the
 * network boundary is the contract, and a responder that reached around it
 * would be measuring a Bokahli no caller sees. But the *shape* of what crosses
 * that boundary has to come from somewhere, and the two available answers were
 * both bad. Hand-maintaining a lookalike schema means two files that agree
 * until the day they quietly do not, and the disagreement surfaces as a
 * campaign that exports evidence about fields it misread. Depending on
 * Bokahli's package would couple a build to a sibling repository.
 *
 * So the type declarations are *generated* — copied verbatim from a pinned
 * published commit, with a lock file recording the commit and a hash of every
 * file. Types only: nothing here executes, and the responder still parses a
 * JSON body defensively rather than trusting a cast. What the pin buys is that
 * a contract change upstream becomes a failing check here instead of a silent
 * misreading.
 *
 *   node scripts/sync-bokahli-contract.mjs --check   (default; CI and tests)
 *   node scripts/sync-bokahli-contract.mjs --sync    (regenerate from the pin)
 *
 * `--sync` reads from a local clone of the Bokahli repository and refuses any
 * commit that is not an ancestor of the published branch, so a local edit
 * cannot become Luak's idea of the contract.
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const OUT_DIR = join(ROOT, "types", "bokahli-contract");
const LOCK = join(OUT_DIR, "contract.lock.json");
const BOKAHLI_REPO = process.env["LUAK_BOKAHLI_REPO"] ?? join(process.env["HOME"] ?? "", "repos/bokahli");
const SOURCE_PREFIX = "packages/contracts/src";
const PUBLISHED_BRANCH = process.env["LUAK_BOKAHLI_BRANCH"] ?? "origin/v2";

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

async function gitShow(commit, path) {
  const { stdout } = await run("git", ["-C", BOKAHLI_REPO, "show", `${commit}:${path}`], {
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

async function listContractFiles(commit) {
  const { stdout } = await run("git", ["-C", BOKAHLI_REPO, "ls-tree", "--name-only", `${commit}:${SOURCE_PREFIX}`]);
  return stdout.split("\n").map((s) => s.trim()).filter((s) => s.endsWith(".ts")).sort();
}

function header(commit, file) {
  return `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Copied verbatim from Bokahli \`${SOURCE_PREFIX}/${file}\` at published commit
 * ${commit}. Regenerate with:
 *
 *   node scripts/sync-bokahli-contract.mjs --sync
 *
 * Edits here are erased on the next sync and, worse, would make Luak's idea of
 * the contract diverge from the deployment it is measuring.
 */
`;
}

async function sync() {
  const commit = process.argv.includes("--commit")
    ? process.argv[process.argv.indexOf("--commit") + 1]
    : (await run("git", ["-C", BOKAHLI_REPO, "rev-parse", PUBLISHED_BRANCH])).stdout.trim();

  // Refuse anything that is not published. A contract pinned to a local branch
  // is a contract nobody else can reproduce.
  await run("git", ["-C", BOKAHLI_REPO, "merge-base", "--is-ancestor", commit, PUBLISHED_BRANCH]).catch(() => {
    throw new Error(`commit ${commit} is not an ancestor of ${PUBLISHED_BRANCH}; refusing to pin an unpublished contract`);
  });

  await mkdir(OUT_DIR, { recursive: true });
  const files = await listContractFiles(commit);
  const lock = { pinnedCommit: commit, publishedBranch: PUBLISHED_BRANCH, sourcePrefix: SOURCE_PREFIX, files: {} };
  for (const f of files) {
    const src = await gitShow(commit, `${SOURCE_PREFIX}/${f}`);
    lock.files[f] = { sourceSha256: sha256(src) };
    await writeFile(join(OUT_DIR, f), header(commit, f) + src, "utf8");
  }
  await writeFile(LOCK, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  process.stderr.write(`pinned ${files.length} contract files at ${commit}\n`);
}

async function check() {
  const lock = JSON.parse(await readFile(LOCK, "utf8"));
  const problems = [];
  const present = (await readdir(OUT_DIR)).filter((f) => f.endsWith(".ts")).sort();
  const expected = Object.keys(lock.files).sort();
  if (present.join(",") !== expected.join(",")) {
    problems.push(`generated files ${present.join(",")} do not match the lock ${expected.join(",")}`);
  }
  for (const [f, meta] of Object.entries(lock.files)) {
    let body;
    try {
      body = await readFile(join(OUT_DIR, f), "utf8");
    } catch {
      problems.push(`${f} is missing`);
      continue;
    }
    const stripped = body.slice(body.indexOf(" */\n") + 4);
    if (sha256(stripped) !== meta.sourceSha256) {
      problems.push(`${f} does not match the pinned source hash; it was edited or re-synced without updating the lock`);
    }
  }
  return { lock, problems };
}

if (process.argv.includes("--sync")) {
  await sync();
} else {
  const { lock, problems } = await check();
  if (problems.length > 0) {
    console.error(`bokahli contract pin is not intact:\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  process.stderr.write(`bokahli contract pin intact at ${lock.pinnedCommit} (${Object.keys(lock.files).length} files)\n`);
}

export { check, OUT_DIR, LOCK };
