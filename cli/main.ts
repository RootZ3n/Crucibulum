#!/usr/bin/env node
/**
 * Luak CLI — Entry Point
 *
 * The binary is exposed as both `luak` (current) and `crucible` (legacy alias)
 * via package.json `bin`. CLI behavior is identical under either name.
 */

import { log, setLogLevel } from "../utils/logger.js";

const args = process.argv.slice(2);
const command = args[0];

// Parse --verbose / --quiet flags
if (args.includes("--verbose")) setLogLevel("debug");
if (args.includes("--quiet")) setLogLevel("warn");

async function main(): Promise<void> {
  switch (command) {
    case "test": {
      const { testCommand } = await import("./commands/test.js");
      await testCommand(args.slice(1));
      break;
    }
    case "list": {
      const { listCommand } = await import("./commands/list.js");
      await listCommand(args.slice(1));
      break;
    }
    case "verify": {
      const { verifyCommand } = await import("./commands/verify.js");
      await verifyCommand(args.slice(1));
      break;
    }
    case "compare": {
      const { compareCommand } = await import("./commands/compare.js");
      await compareCommand(args.slice(1));
      break;
    }
    case "leaderboard": {
      const { leaderboardCommand } = await import("./commands/leaderboard.js");
      await leaderboardCommand(args.slice(1));
      break;
    }
    case "replay": {
      const { replayCommand } = await import("./commands/replay.js");
      await replayCommand(args.slice(1));
      break;
    }
    case "doctor": {
      const { doctorCommand } = await import("./commands/doctor.js");
      await doctorCommand(args.slice(1));
      break;
    }
    case "oracle-hash": {
      const { oracleHashCommand } = await import("./commands/oracle-hash.js");
      await oracleHashCommand(args.slice(1));
      break;
    }
    case "init-task": {
      const { initTaskCommand } = await import("./commands/init-task.js");
      await initTaskCommand(args.slice(1));
      break;
    }
    case "harness":
    case "qa": {
      const { harnessCommand } = await import("./commands/harness.js");
      await harnessCommand(args.slice(1));
      break;
    }
    default:
      console.log(`Luak — Execution-Based AI Agent Evaluation

Usage:
  luak test    --model <model> --task <taskId> [--runs N]
  luak list    tasks [--family poison|spec|orchestration]
  luak list    runs [--task <taskId>]
  luak verify  <bundle_id>
  luak compare --models <a>,<b> --task <taskId> [--runs N] [--max-cost-usd N]
               # model spec is "adapter:model" (e.g. openrouter:openai/gpt-4o-mini,
               # ollama:gemma3:27b). Adapter = text before the first colon;
               # a bare value with no colon defaults to ollama.
               # See "luak compare --help" for the full worked example.
  luak init-task <family> <task-id>
               # scaffold tasks/<family>/<task-id>/ with provenance stubs,
               # fixtures/, oracle/, and an npm run oracle:hash reminder
  luak leaderboard [show|submit]
  luak replay  <bundle_id>
  luak oracle-hash [--write|--check|--dry-run]
  luak doctor
  luak harness [--tab <key>] [--task <id>]
               [--adapter <id> --model <model>]   # live: route through registry
               [--live --model <model>]           # legacy: OpenRouter + judge model
               [--provider <id>]                  # configurable adapters only
               [--enable-judge] [--output <path>]

  Without --adapter or --live the harness uses the offline mock adapter.

  Examples:
    # offline mock (no API calls):
    luak harness --task safety-001
    # live OpenRouter:
    luak harness --adapter openrouter --model minimax/minimax-m2 --task safety-001
    # live MiniMax direct (needs MINIMAX_API_KEY):
    luak harness --adapter minimax --model MiniMax-M2.7 --task safety-001

  Legacy alias: the binary is also installed as \`crucible\`; all subcommands
  work identically under either name.

Options:
  --verbose    Show debug output
  --quiet      Suppress info messages
  --output     Output format: table (default), json

Exit codes:
  0  Task passed
  1  Task failed
  2  Integrity violation
  3  Harness error
  4  Injection detected
  5  Adapter / config error (unknown id, missing key, missing --model)`);
      process.exit(command ? 3 : 0);
  }
}

main().catch(err => {
  console.error("Luak error:", err);
  process.exit(3);
});
