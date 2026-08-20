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

/**
 * The reviewed pin. Not "any ancestor of the published branch".
 *
 * The first version gated on ancestry, which sounded strict and permitted a
 * silent downgrade: `4d8ced6` is an ancestor of `origin/v2`, and syncing to it
 * succeeded — swapping in the contract from *before* the encode canary existed
 * while every check still reported a healthy pin. Ancestry answers "was this
 * ever published", and the question is "is this the contract we audited".
 *
 * Changing this constant is a reviewable diff. That is the point.
 */
const REVIEWED_PIN = "9ed481bed93e0a2b936c489649ed3244b69744ec";

/** Which repository. A branch name is not an identity; two clones can share one. */
const EXPECTED_REMOTE = "git@github.com:RootZ3n/bokahli.git";

/** Bumped when the generated layout or the lock schema changes. */
const GENERATOR_VERSION = "bokahli-contract-sync-2";

/**
 * Exactly these files, no more and no fewer.
 *
 * An extra file in the contract directory is a file nothing reviewed; a missing
 * one is a type the consumer will silently stop checking against.
 */
const SOURCE_ALLOWLIST = Object.freeze([
  "attestation.ts", "canary.ts", "errors.ts", "identity.ts", "index.ts",
  "luak.ts", "qualification.ts", "routing.ts", "tasks.ts",
]);

/**
 * Hash of the lock file itself, as reviewed.
 *
 * Without it, "edit a generated file and regenerate the lock" is a clean pass:
 * the lock only ever certifies whatever is on disk beside it. Anchoring the
 * lock to a constant in reviewed source closes that loop.
 */
const EXPECTED_LOCK_SHA256 = "6ff44ffd391a0acbe5aa90a74fb5397580e88822f2ac241faec012268e41da26";

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

async function gitShow(commit, path) {
  const { stdout } = await run("git", ["-C", BOKAHLI_REPO, "show", `${commit}:${path}`], {
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

/**
 * Files at the pinned commit, with their modes.
 *
 * Modes matter: a symlink in the source tree would make the generated contract
 * depend on what the link resolved to at sync time rather than on content the
 * commit names, so symlinks are refused rather than followed.
 */
async function listContractEntries(commit) {
  const { stdout } = await run("git", ["-C", BOKAHLI_REPO, "ls-tree", `${commit}:${SOURCE_PREFIX}`]);
  const out = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(/^(\d{6})\s+(\w+)\s+[0-9a-f]+\t(.+)$/);
    if (m === null) continue;
    const [, mode, type, name] = m;
    if (!name.endsWith(".ts")) continue;
    if (mode === "120000") throw new Error(`${name} is a symlink in the pinned tree; refusing to follow it`);
    if (type !== "blob") throw new Error(`${name} is not a regular file in the pinned tree`);
    out.push(name);
  }
  return out.sort();
}

async function remoteUrl() {
  const { stdout } = await run("git", ["-C", BOKAHLI_REPO, "remote", "get-url", "origin"]);
  return stdout.trim();
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
  const wants = process.argv.includes("--commit")
    ? process.argv[process.argv.indexOf("--commit") + 1]
    : REVIEWED_PIN;
  const allowPinChange = process.argv.includes("--allow-pin-change");

  if (wants !== REVIEWED_PIN && !allowPinChange) {
    throw new Error(
      `refusing to sync ${wants}: the reviewed pin is ${REVIEWED_PIN}. Upgrading the ` +
        "contract is a reviewed change, not a command-line flag — re-run with " +
        "--allow-pin-change and update REVIEWED_PIN and EXPECTED_LOCK_SHA256 in the same commit.",
    );
  }

  // Which repository, not just which branch name. Two clones can carry the same
  // branch and different history.
  const url = await remoteUrl();
  if (url !== EXPECTED_REMOTE) {
    throw new Error(`origin is ${url}, not the expected ${EXPECTED_REMOTE}`);
  }

  // Published, and specifically the reviewed commit. Ancestry alone permitted a
  // downgrade to a pre-canary contract.
  await run("git", ["-C", BOKAHLI_REPO, "merge-base", "--is-ancestor", wants, PUBLISHED_BRANCH]).catch(() => {
    throw new Error(`commit ${wants} is not an ancestor of ${PUBLISHED_BRANCH}; refusing to pin an unpublished contract`);
  });

  const files = await listContractEntries(wants);
  const missing = SOURCE_ALLOWLIST.filter((f) => !files.includes(f));
  const extra = files.filter((f) => !SOURCE_ALLOWLIST.includes(f));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `the pinned tree does not match the reviewed file set` +
        `${missing.length > 0 ? `; missing ${missing.join(", ")}` : ""}` +
        `${extra.length > 0 ? `; unreviewed ${extra.join(", ")}` : ""}`,
    );
  }

  // Show what is proposed before writing anything.
  let previous = null;
  try {
    previous = JSON.parse(await readFile(LOCK, "utf8"));
  } catch { /* first sync */ }
  process.stderr.write(`proposed source commit: ${wants}\n`);
  if (previous !== null && previous.pinnedCommit !== wants) {
    process.stderr.write(`  (pin changes from ${previous.pinnedCommit})\n`);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const lock = {
    generatorVersion: GENERATOR_VERSION,
    remote: EXPECTED_REMOTE,
    pinnedCommit: wants,
    publishedBranch: PUBLISHED_BRANCH,
    sourcePrefix: SOURCE_PREFIX,
    files: {},
  };
  const changed = [];
  for (const f of SOURCE_ALLOWLIST) {
    const src = await gitShow(wants, `${SOURCE_PREFIX}/${f}`);
    const hash = sha256(src);
    lock.files[f] = { sourceSha256: hash };
    if (previous?.files?.[f]?.sourceSha256 !== hash) changed.push(f);
    await writeFile(join(OUT_DIR, f), header(wants, f) + src, "utf8");
  }
  const body = `${JSON.stringify(lock, null, 2)}\n`;
  await writeFile(LOCK, body, "utf8");
  process.stderr.write(
    `changed files: ${changed.length === 0 ? "(none)" : changed.join(", ")}\n` +
      `lock sha256: ${sha256(body)}\n` +
      `pinned ${SOURCE_ALLOWLIST.length} contract files at ${wants}\n`,
  );
  if (sha256(body) !== EXPECTED_LOCK_SHA256) {
    process.stderr.write(
      "NOTE: the lock hash differs from EXPECTED_LOCK_SHA256 in this script. Update that " +
        "constant in the same reviewed commit, or `--check` will fail.\n",
    );
  }
}

async function check() {
  // Read-only by construction: this function opens nothing for writing, so a
  // check can never repair the thing it is checking.
  const problems = [];
  let lockBody;
  try {
    lockBody = await readFile(LOCK, "utf8");
  } catch {
    return { lock: null, problems: ["the contract lock is missing"] };
  }
  const lockHash = sha256(lockBody);
  if (lockHash !== EXPECTED_LOCK_SHA256) {
    problems.push(
      `the lock hashes to ${lockHash}, not the reviewed ${EXPECTED_LOCK_SHA256}: the generated ` +
        "contract was re-synced or edited without a reviewed change to this script",
    );
  }
  let lock;
  try {
    lock = JSON.parse(lockBody);
  } catch {
    return { lock: null, problems: [...problems, "the contract lock is not valid JSON"] };
  }
  if (lock.pinnedCommit !== REVIEWED_PIN) {
    problems.push(`the lock pins ${lock.pinnedCommit}, not the reviewed ${REVIEWED_PIN}`);
  }
  if (lock.generatorVersion !== GENERATOR_VERSION) {
    problems.push(`the lock was written by ${lock.generatorVersion}, not ${GENERATOR_VERSION}`);
  }
  if (lock.remote !== EXPECTED_REMOTE) {
    problems.push(`the lock names remote ${lock.remote}, not ${EXPECTED_REMOTE}`);
  }

  const present = (await readdir(OUT_DIR)).filter((f) => f.endsWith(".ts")).sort();
  if (present.join(",") !== [...SOURCE_ALLOWLIST].sort().join(",")) {
    problems.push(`generated files ${present.join(",")} do not match the reviewed allowlist`);
  }
  if (Object.keys(lock.files ?? {}).sort().join(",") !== [...SOURCE_ALLOWLIST].sort().join(",")) {
    problems.push("the lock does not cover exactly the reviewed allowlist");
  }
  for (const f of SOURCE_ALLOWLIST) {
    const meta = lock.files?.[f];
    if (meta === undefined) continue;
    let body;
    try {
      body = await readFile(join(OUT_DIR, f), "utf8");
    } catch {
      problems.push(`${f} is missing`);
      continue;
    }
    const stripped = body.slice(body.indexOf(" */\n") + 4);
    if (sha256(stripped) !== meta.sourceSha256) {
      problems.push(`${f} does not match the pinned source hash; it was edited or re-synced`);
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
  process.stderr.write(`bokahli contract pin intact at ${lock.pinnedCommit} (${Object.keys(lock.files).length} files, generator ${lock.generatorVersion})\n`);
}

export { check, OUT_DIR, LOCK };
