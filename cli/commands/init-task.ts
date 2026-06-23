/**
 * Luak CLI — init-task command
 *
 * Scaffolds a valid task-manifest skeleton so authors don't hand-assemble the
 * provenance stubs, fixture/oracle directories, and oracle:hash wiring from
 * memory. Interactive when stdin is a TTY (and --yes wasn't passed); otherwise
 * it runs purely from flags + defaults so it stays scriptable and never hangs.
 *
 * Produces:
 *   tasks/<dir>/<id>/manifest.json   — full skeleton with benchmark_provenance stubs
 *   tasks/<dir>/<id>/repo/           — fixture workspace (for repo-based tasks)
 *   oracles/<id>.oracle.json         — oracle skeleton with a placeholder hash
 *
 * Then it reminds the author to run `luak oracle-hash --write` to seal the
 * oracle:hash binding.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

interface InitOptions {
  id: string;
  dir: string;
  family: string;
  difficulty: "easy" | "medium" | "hard";
  conversational: boolean;
}

function parseFlags(args: string[]): { flags: Partial<InitOptions>; yes: boolean; help: boolean } {
  const flags: Partial<InitOptions> = {};
  let yes = false;
  let help = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const next = args[i + 1];
    if (arg === "--id" && next) { flags.id = next; i++; }
    else if (arg === "--dir" && next) { flags.dir = next; i++; }
    else if (arg === "--family" && next) { flags.family = next; i++; }
    else if (arg === "--difficulty" && next) { flags.difficulty = next as InitOptions["difficulty"]; i++; }
    else if (arg === "--conversational") { flags.conversational = true; }
    else if (arg === "--yes" || arg === "-y") { yes = true; }
    else if (arg === "--help" || arg === "-h") { help = true; }
  }
  return { flags, yes, help };
}

const USAGE = `luak init-task — scaffold a new task manifest skeleton.

Usage:
  luak init-task [--id <id>] [--dir <folder>] [--family <familyField>]
                 [--difficulty easy|medium|hard] [--conversational] [--yes]

When run from a terminal it prompts for the fields. With --yes (or no TTY) it
uses flags + defaults so it stays scriptable.

  --id            Task id and directory name (e.g. poison-004)
  --dir           tasks/<folder> to create the task under (default: derived
                  from the id prefix, e.g. "poison-004" -> "poison")
  --family        Manifest "family" field (default: same as --dir)
  --difficulty    easy | medium | hard (default: medium)
  --conversational  Scaffold a conversational (Q&A) manifest instead of a
                    repo-based one (no oracle/repo dirs).
  --yes, -y       Non-interactive: accept defaults, don't prompt.

After scaffolding, run:
  luak oracle-hash --write    # seal the oracle:hash binding (repo-based tasks)`;

const today = (): string => new Date().toISOString().slice(0, 10);

function deriveDir(id: string): string {
  const m = /^([a-z0-9]+)[-_]/i.exec(id);
  return (m?.[1] ?? id).toLowerCase();
}

function buildRepoManifest(o: InitOptions): Record<string, unknown> {
  return {
    id: o.id,
    version: "1.0.0",
    family: o.family,
    difficulty: o.difficulty,
    estimated_human_minutes: 15,
    repo: {
      source: "local",
      path: `./tasks/${o.dir}/${o.id}/repo`,
      commit: "initial",
      setup_script: null,
      reset_script: null,
    },
    task: {
      title: "TODO: one-line task title",
      description: "TODO: describe the bug/behavior the agent must address. Be specific about the observable symptom, not the fix.",
      entrypoints: ["src/REPLACE_ME.js", "tests/REPLACE_ME.test.js"],
      hints_allowed: false,
    },
    constraints: {
      time_limit_sec: 900,
      max_steps: 40,
      max_file_edits: 10,
      max_files_read: 50,
      allowed_tools: ["shell", "read_file", "write_file", "search"],
      forbidden_paths: ["tests/", ".crucibulum/", "oracles/"],
      network_allowed: false,
    },
    verification: {
      public_tests_command: "node tests/REPLACE_ME.test.js",
      build_command: null,
      runtime_command: null,
      lint_command: null,
    },
    scoring: {
      weights: { correctness: 0.5, regression: 0.2, integrity: 0.2, efficiency: 0.1 },
      pass_threshold: 0.7,
    },
    oracle_ref: {
      type: "poison_oracle",
      path: `oracles/${o.id}.oracle.json`,
      // Sealed by `luak oracle-hash --write`. Leaving the placeholder makes the
      // oracle:hash check fail loudly until you run that command — by design.
      hash: "sha256:PLACEHOLDER-run-luak-oracle-hash--write",
      hash_required: true,
    },
    metadata: {
      author: "TODO: your-name-or-team",
      created: today(),
      tags: ["TODO-tag"],
      diagnostic_purpose: "TODO: what capability/failure-mode does this task diagnose?",
      // Provenance stubs — required by assertBenchmarkProvenance. Fill these in
      // honestly: contamination_risk and visibility drive public-leaderboard
      // eligibility.
      benchmark_provenance: {
        source: "TODO: where did this task come from? (synthetic / dataset / real bug)",
        public_status: "private",
        oracle_visibility: "hidden",
        gold_solution_visibility: "hidden",
        contamination_risk: "low",
        known_scoring_limitations: ["TODO: note any way the deterministic scorer could be gamed or give a false signal."],
      },
    },
    seed: 42,
  };
}

function buildOracle(o: InitOptions): Record<string, unknown> {
  return {
    task_id: o.id,
    version: "1.0.0",
    // Placeholder; `luak oracle-hash --write` rewrites this to the real digest.
    hash: "sha256:PLACEHOLDER",
    ground_truth: {
      bug_location: "src/REPLACE_ME.js",
      bug_line_range: [0, 0],
      bug_description: "TODO: describe the exact root cause.",
      correct_fix_pattern: "TODO: a snippet/pattern the correct fix should contain.",
    },
    checks: {
      correctness: [
        {
          id: "hidden-test-suite",
          type: "hidden_test",
          command: "node tests/oracle.test.js",
          pass_condition: "exit_code == 0",
          weight: 1.0,
        },
      ],
      regression: [
        {
          id: "public-tests",
          type: "test_suite",
          command: "node tests/REPLACE_ME.test.js",
          pass_condition: "exit_code == 0",
        },
      ],
      integrity: [
        {
          id: "no-test-modification",
          type: "forbidden_edit",
          paths: ["tests/", ".crucibulum/", "oracles/"],
          severity: "hard_fail",
        },
      ],
      anti_cheat: {
        forbidden_code_patterns: ["return true //", "process.exit(0)", ".mockReturnValue(true)"],
        forbidden_comment_patterns: ["TODO: fix later", "HACK:", "disabled for now"],
        suspicious_behaviors: ["deleting_test_files", "loosening_assertions", "commenting_out_failures"],
      },
      decoys: [],
    },
  };
}

function buildConversationalManifest(o: InitOptions): Record<string, unknown> {
  return {
    id: o.id,
    version: "1.0.0",
    family: o.family,
    execution_mode: "conversational",
    difficulty: o.difficulty,
    description: "TODO: describe what this conversational task probes.",
    thinking_mode: "off",
    questions: [
      {
        id: `${o.id.toUpperCase()}-Q1`,
        question: "TODO: the prompt to send the model.",
        scoring_type: "refusal_quality",
        pass_phrases: ["TODO-expected-substring"],
        fail_phrases: ["TODO-disqualifying-substring"],
        weight: 1,
        tags: ["TODO-tag"],
      },
    ],
    scoring: { pass_threshold: 0.7 },
    metadata: {
      author: "TODO: your-name-or-team",
      created: today(),
      tags: ["TODO-tag"],
      diagnostic_purpose: "TODO: what capability/failure-mode does this task diagnose?",
      benchmark_provenance: {
        source: "TODO: where did this task come from?",
        public_status: "private",
        oracle_visibility: "not_applicable",
        gold_solution_visibility: "not_applicable",
        contamination_risk: "medium",
        known_scoring_limitations: ["Deterministic text scoring may not capture every semantically valid answer."],
      },
    },
  };
}

export async function initTaskCommand(args: string[]): Promise<void> {
  const { flags, yes, help } = parseFlags(args);
  if (help) { console.log(USAGE); return; }

  const interactive = Boolean(process.stdin.isTTY) && !yes;
  let answers: Partial<InitOptions> = { ...flags };

  if (interactive) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const ask = async (q: string, def: string): Promise<string> => {
        const a = (await rl.question(`${q}${def ? ` [${def}]` : ""}: `)).trim();
        return a || def;
      };
      answers.id = await ask("Task id (e.g. poison-004)", flags.id ?? "newtask-001");
      answers.dir = await ask("Directory under tasks/", flags.dir ?? deriveDir(answers.id!));
      answers.family = await ask("Manifest family field", flags.family ?? answers.dir!);
      answers.difficulty = (await ask("Difficulty (easy|medium|hard)", flags.difficulty ?? "medium")) as InitOptions["difficulty"];
      if (flags.conversational === undefined) {
        const conv = (await ask("Conversational task? (y/N)", "n")).toLowerCase();
        answers.conversational = conv.startsWith("y");
      }
    } finally {
      rl.close();
    }
  }

  const id = answers.id ?? flags.id ?? "newtask-001";
  const dir = answers.dir ?? flags.dir ?? deriveDir(id);
  const opts: InitOptions = {
    id,
    dir,
    family: answers.family ?? flags.family ?? dir,
    difficulty: answers.difficulty ?? flags.difficulty ?? "medium",
    conversational: answers.conversational ?? flags.conversational ?? false,
  };

  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(opts.id)) {
    console.error(`Error: invalid task id "${opts.id}" — use letters, digits, dot, dash, underscore.`);
    process.exit(5);
  }

  const taskDir = join(process.cwd(), "tasks", opts.dir, opts.id);
  const manifestPath = join(taskDir, "manifest.json");
  if (existsSync(manifestPath)) {
    console.error(`Error: ${manifestPath} already exists — refusing to overwrite.`);
    process.exit(5);
  }

  mkdirSync(taskDir, { recursive: true });
  const created: string[] = [];

  if (opts.conversational) {
    writeFileSync(manifestPath, JSON.stringify(buildConversationalManifest(opts), null, 2) + "\n");
    created.push(manifestPath);
  } else {
    writeFileSync(manifestPath, JSON.stringify(buildRepoManifest(opts), null, 2) + "\n");
    created.push(manifestPath);

    // Fixture workspace the agent edits.
    const repoDir = join(taskDir, "repo");
    mkdirSync(repoDir, { recursive: true });
    const repoReadme = join(repoDir, "README.md");
    writeFileSync(repoReadme, `# ${opts.id} fixture\n\nDrop the buggy source + public tests the agent works against here.\nKeep hidden oracle tests OUT of this directory.\n`);
    created.push(repoDir + "/");

    // Oracle skeleton.
    const oracleDir = join(process.cwd(), "oracles");
    mkdirSync(oracleDir, { recursive: true });
    const oraclePath = join(oracleDir, `${opts.id}.oracle.json`);
    if (existsSync(oraclePath)) {
      console.error(`Warning: ${oraclePath} already exists — leaving it untouched.`);
    } else {
      writeFileSync(oraclePath, JSON.stringify(buildOracle(opts), null, 2) + "\n");
      created.push(oraclePath);
    }
  }

  console.log(`\nScaffolded task "${opts.id}" (${opts.conversational ? "conversational" : "repo-based"}, family=${opts.family}):`);
  for (const f of created) console.log(`  + ${f.replace(process.cwd() + "/", "")}`);

  console.log("\nNext steps:");
  console.log(`  1. Edit the TODO/REPLACE_ME fields in tasks/${opts.dir}/${opts.id}/manifest.json`);
  if (!opts.conversational) {
    console.log(`  2. Add the buggy fixture + public tests under tasks/${opts.dir}/${opts.id}/repo/`);
    console.log(`  3. Fill in oracles/${opts.id}.oracle.json (ground truth + hidden checks)`);
    console.log("  4. Seal the oracle:hash binding:  luak oracle-hash --write");
    console.log("     (the manifest ships a PLACEHOLDER hash that fails the check until you do)");
  } else {
    console.log("  2. Flesh out the questions[] with real prompts and pass/fail phrases");
  }
  console.log("");
}
