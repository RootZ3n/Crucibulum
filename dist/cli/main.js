#!/usr/bin/env node
/**
 * Crucibulum CLI — Entry Point
 */
import { setLogLevel } from "../utils/logger.js";
const args = process.argv.slice(2);
const command = args[0];
// Parse --verbose / --quiet flags
if (args.includes("--verbose"))
    setLogLevel("debug");
if (args.includes("--quiet"))
    setLogLevel("warn");
async function main() {
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
        case "compare":
        case "replay":
        case "leaderboard":
            console.log(`Command '${command}' is planned for V1.1`);
            process.exit(0);
            break;
        default:
            console.log(`Crucibulum — Execution-Based AI Agent Evaluation

Usage:
  crucibulum test    --model <model> --task <taskId> [--runs N]
  crucibulum list    tasks [--family poison|spec|orchestration]
  crucibulum list    runs [--task <taskId>]
  crucibulum verify  <bundle_id>
  crucibulum compare --models <a>,<b> --task <taskId>
  crucibulum replay  <bundle_id>

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
//# sourceMappingURL=main.js.map