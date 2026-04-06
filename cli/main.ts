#!/usr/bin/env node
/**
 * Crucibulum CLI — Entry Point
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
    default:
      console.log(`Crucibulum — Execution-Based AI Agent Evaluation

Usage:
  crucibulum test    --model <model> --task <taskId> [--runs N]
  crucibulum list    tasks [--family poison|spec|orchestration]
  crucibulum list    runs [--task <taskId>]
  crucibulum verify  <bundle_id>
  crucibulum compare --models <a>,<b> --task <taskId> [--runs N]
  crucibulum leaderboard [show|submit]
  crucibulum replay  <bundle_id>
  crucibulum doctor

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
  5  Adapter error`);
      process.exit(command ? 3 : 0);
  }
}

main().catch(err => {
  console.error("Crucibulum error:", err);
  process.exit(3);
});
