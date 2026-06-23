/**
 * Luak CLI — init-task command
 *
 * Scaffolds a task-local benchmark skeleton:
 *   tasks/<family>/<task-id>/manifest.json
 *   tasks/<family>/<task-id>/fixtures/
 *   tasks/<family>/<task-id>/oracle/
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { assertSafeId } from "../../utils/safe-id.js";

interface InitOptions {
  family: string;
  id: string;
  difficulty: "easy" | "medium" | "hard";
}

interface ParsedArgs {
  positional: string[];
  flags: Partial<InitOptions>;
  yes: boolean;
  help: boolean;
}

const USAGE = `luak init-task — scaffold a new task manifest skeleton.

Usage:
  luak init-task <family> <task-id> [--difficulty easy|medium|hard]
  luak init-task --family <family> --id <task-id> [--yes]

When run from a terminal with missing fields, luak prompts for them.

Arguments:
  family       Directory under tasks/ and manifest family field
  task-id      Task id and directory name

Options:
  --family       Family value, equivalent to the first positional argument
  --id           Task id, equivalent to the second positional argument
  --difficulty   easy | medium | hard (default: medium)
  --yes, -y      Non-interactive: accept defaults for omitted fields

After scaffolding, run:
  npm run oracle:hash -- --write`;

function parseArgs(args: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Partial<InitOptions> = {};
  let yes = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const next = args[i + 1];
    if (arg === "--family" && next) {
      flags.family = next;
      i++;
    } else if (arg === "--id" && next) {
      flags.id = next;
      i++;
    } else if (arg === "--difficulty" && next) {
      flags.difficulty = next as InitOptions["difficulty"];
      i++;
    } else if (arg === "--yes" || arg === "-y") {
      yes = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg.startsWith("--")) {
      console.error(`Error: unknown option ${arg}`);
      process.exit(5);
    } else {
      positional.push(arg);
    }
  }

  return { positional, flags, yes, help };
}

const today = (): string => new Date().toISOString().slice(0, 10);

function parseDifficulty(value: string | undefined): InitOptions["difficulty"] {
  if (value === undefined || value === "") return "medium";
  if (value === "easy" || value === "medium" || value === "hard") return value;
  console.error(`Error: invalid difficulty "${value}" — use easy, medium, or hard.`);
  process.exit(5);
}

function buildManifest(o: InitOptions): Record<string, unknown> {
  return {
    id: o.id,
    version: "1.0.0",
    family: o.family,
    difficulty: o.difficulty,
    repo: {
      source: "local",
      path: `./tasks/${o.family}/${o.id}/fixtures`,
      commit: "TODO: pin fixture revision or describe local skeleton",
      setup_script: null,
      reset_script: null,
    },
    task: {
      title: "TODO: one-line task title",
      description: "TODO: describe the observable behavior the agent must fix or satisfy.",
      entrypoints: ["TODO: fixtures/path/to/start.js"],
      hints_allowed: false,
    },
    constraints: {
      time_limit_sec: 900,
      max_steps: 40,
      max_file_edits: 10,
      max_files_read: 50,
      allowed_tools: ["shell", "read_file", "write_file", "search"],
      forbidden_paths: ["oracle/", ".crucibulum/"],
      network_allowed: false,
    },
    verification: {
      public_tests_command: "TODO: command run from the fixture workspace",
      build_command: null,
      runtime_command: null,
      lint_command: null,
    },
    scoring: {
      weights: {
        correctness: 0.5,
        regression: 0.2,
        integrity: 0.2,
        efficiency: 0.1,
      },
      pass_threshold: 0.7,
    },
    oracle_ref: {
      type: "local",
      path: `tasks/${o.family}/${o.id}/oracle/${o.id}.oracle.json`,
      hash: "sha256:placeholder",
      hash_required: true,
    },
    metadata: {
      author: "TODO: your-name-or-team",
      created: today(),
      tags: ["TODO-tag"],
      diagnostic_purpose: "TODO: what capability or failure mode this task diagnoses.",
      benchmark_provenance: {
        source: "TODO: synthetic / dataset / real bug / other origin",
        public_status: "private",
        oracle_visibility: "hidden",
        gold_solution_visibility: "hidden",
        contamination_risk: "low",
        known_scoring_limitations: [
          "TODO: note how this scorer could produce a false positive or false negative.",
        ],
      },
    },
    seed: 42,
  };
}

function buildOracle(o: InitOptions): Record<string, unknown> {
  return {
    task_id: o.id,
    version: "1.0.0",
    hash: "sha256:placeholder",
    ground_truth: {
      bug_location: "TODO: fixture path",
      bug_line_range: [0, 0],
      bug_description: "TODO: exact root cause or expected target behavior.",
      correct_fix_pattern: "TODO: pattern or invariant expected in a correct solution.",
    },
    checks: {
      correctness: [
        {
          id: "hidden-oracle",
          type: "hidden_test",
          command: "TODO: hidden oracle command",
          pass_condition: "exit_code == 0",
          weight: 1,
        },
      ],
      regression: [
        {
          id: "public-tests",
          type: "test_suite",
          command: "TODO: public test command",
          pass_condition: "exit_code == 0",
        },
      ],
      integrity: [
        {
          id: "no-oracle-modification",
          type: "forbidden_edit",
          paths: ["oracle/", ".crucibulum/"],
          severity: "hard_fail",
        },
      ],
      anti_cheat: {
        forbidden_code_patterns: ["process.exit(0)", ".skip(", ".only("],
        forbidden_comment_patterns: ["TODO: bypass", "HACK:"],
        suspicious_behaviors: ["deleting_tests", "loosening_assertions", "commenting_out_failures"],
      },
      decoys: [],
    },
  };
}

async function promptForMissing(options: Partial<InitOptions>, skip: boolean): Promise<Partial<InitOptions>> {
  if (skip || !process.stdin.isTTY) return options;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ask = async (question: string, fallback: string): Promise<string> => {
      const answer = (await rl.question(`${question} [${fallback}]: `)).trim();
      return answer || fallback;
    };

    if (!options.family) options.family = await ask("Task family", "new-family");
    if (!options.id) options.id = await ask("Task id", "new-task-001");
    if (!options.difficulty) {
      options.difficulty = parseDifficulty(await ask("Difficulty (easy|medium|hard)", "medium"));
    }
    return options;
  } finally {
    rl.close();
  }
}

export async function initTaskCommand(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  if (parsed.help) {
    console.log(USAGE);
    return;
  }

  const requested: Partial<InitOptions> = {
    family: parsed.flags.family ?? parsed.positional[0],
    id: parsed.flags.id ?? parsed.positional[1],
  };
  if (parsed.flags.difficulty !== undefined) requested.difficulty = parsed.flags.difficulty;

  const prompted = await promptForMissing(requested, parsed.yes);

  const opts: InitOptions = {
    family: prompted.family ?? "new-family",
    id: prompted.id ?? "new-task-001",
    difficulty: parseDifficulty(prompted.difficulty),
  };

  try {
    assertSafeId(opts.family, "task family");
    assertSafeId(opts.id, "task id");
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(5);
  }

  const taskDir = join(process.cwd(), "tasks", opts.family, opts.id);
  const manifestPath = join(taskDir, "manifest.json");
  const fixturesDir = join(taskDir, "fixtures");
  const oracleDir = join(taskDir, "oracle");
  const oraclePath = join(oracleDir, `${opts.id}.oracle.json`);

  if (existsSync(manifestPath)) {
    console.error(`Error: ${manifestPath} already exists — refusing to overwrite.`);
    process.exit(5);
  }

  mkdirSync(fixturesDir, { recursive: true });
  mkdirSync(oracleDir, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(buildManifest(opts), null, 2) + "\n", "utf-8");
  writeFileSync(oraclePath, JSON.stringify(buildOracle(opts), null, 2) + "\n", "utf-8");

  console.log(`Scaffolded task ${opts.id}`);
  console.log(`  + tasks/${opts.family}/${opts.id}/manifest.json`);
  console.log(`  + tasks/${opts.family}/${opts.id}/fixtures/`);
  console.log(`  + tasks/${opts.family}/${opts.id}/oracle/${opts.id}.oracle.json`);
  console.log("");
  console.log("Next steps:");
  console.log(`  1. Fill TODO fields in tasks/${opts.family}/${opts.id}/manifest.json`);
  console.log(`  2. Add fixture files under tasks/${opts.family}/${opts.id}/fixtures/`);
  console.log(`  3. Fill oracle checks under tasks/${opts.family}/${opts.id}/oracle/`);
  console.log("  4. Run npm run oracle:hash -- --write");
}
