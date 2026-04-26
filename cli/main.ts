#!/usr/bin/env node
/**
 * Crucible CLI — Entry Point
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
    case "harness":
    case "qa": {
      const { harnessCommand } = await import("./commands/harness.js");
      await harnessCommand(args.slice(1));
      break;
    }
    default:
      console.log(`Crucible — Execution-Based AI Agent Evaluation

Usage:
  crucible test    --model <model> --task <taskId> [--runs N]
  crucible list    tasks [--family poison|spec|orchestration]
  crucible list    runs [--task <taskId>]
  crucible verify  <bundle_id>
  crucible compare --models <a>,<b> --task <taskId> [--runs N]
  crucible leaderboard [show|submit]
  crucible replay  <bundle_id>
  crucible oracle-hash [--write|--check|--dry-run]
  crucible doctor
  crucible harness [--tab <key>] [--task <id>]
                   [--adapter <id> --model <model>]   # live: route through registry
                   [--live --model <model>]           # legacy: OpenRouter + judge model
                   [--provider <id>]                  # configurable adapters only
                   [--enable-judge] [--output <path>]

  Without --adapter or --live the harness uses the offline mock adapter.

  Examples:
    # offline mock (no API calls):
    crucible harness --task safety-001
    # live OpenRouter:
    crucible harness --adapter openrouter --model minimax/minimax-m2 --task safety-001
    # live MiniMax direct (needs MINIMAX_API_KEY):
    crucible harness --adapter minimax --model MiniMax-M2.7 --task safety-001

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
  console.error("Crucible error:", err);
  process.exit(3);
});
