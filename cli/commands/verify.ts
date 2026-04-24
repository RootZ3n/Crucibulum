/**
 * Crucible CLI — verify command
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyBundle } from "../../core/bundle.js";
import type { EvidenceBundle } from "../../adapters/base.js";

export async function verifyCommand(args: string[]): Promise<void> {
  const bundleId = args[0];
  if (!bundleId) { console.error("Usage: crucible verify <bundle_id>"); process.exit(3); }

  const runsDir = process.env["CRUCIBULUM_RUNS_DIR"] ?? join(process.cwd(), "runs");
  const filePath = join(runsDir, `${bundleId}.json`);

  try {
    const raw = readFileSync(filePath, "utf-8");
    const bundle = JSON.parse(raw) as EvidenceBundle;
    const result = verifyBundle(bundle);

    if (result.valid) {
      console.log(`\x1b[32m✓ Bundle verified\x1b[0m: ${bundleId}`);
      console.log(`  Hash: ${result.computed}`);
    } else {
      console.log(`\x1b[31m✗ Bundle TAMPERED\x1b[0m: ${bundleId}`);
      console.log(`  Expected: ${result.expected}`);
      console.log(`  Computed: ${result.computed}`);
      process.exit(2);
    }
  } catch (err) {
    console.error(`Cannot read bundle: ${String(err)}`);
    process.exit(3);
  }
}
