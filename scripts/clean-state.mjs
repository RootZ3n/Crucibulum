/**
 * Crucible — safely clear local-only state.
 *
 * Removes only the directories Crucible writes to during local runs:
 *   runs/   evidence bundles and harness reports
 *   state/  auth tokens, sessions, provider registry data
 *
 * Refuses to run if either directory is not inside the repo root, and
 * requires the caller to pass --confirm to actually delete anything.
 */
import { rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const targets = ["runs", "state"];
const confirm = process.argv.includes("--confirm");

if (!confirm) {
  console.log("Crucible clean:state — preview mode (no deletion).\n");
  console.log("This will remove the following local directories:");
  for (const t of targets) console.log(`  ${join(root, t)}`);
  console.log("\nThis deletes generated evidence bundles, auth tokens, and the");
  console.log("local provider registry. Imported evidence stored elsewhere is");
  console.log("not affected. Stop the server before running the real command.");
  console.log("\nTo actually clear local state, run:");
  console.log("  npm run clean:state -- --confirm");
  process.exit(0);
}

let removed = 0;
let skipped = 0;
for (const t of targets) {
  const path = join(root, t);
  // Defensive: only delete a child of repo root.
  if (!path.startsWith(root + (process.platform === "win32" ? "\\" : "/"))) {
    console.error(`Refusing to delete path outside repo root: ${path}`);
    process.exit(2);
  }
  try {
    await stat(path);
    await rm(path, { recursive: true, force: true });
    console.log(`removed ${path}`);
    removed++;
  } catch (err) {
    if (err && err.code === "ENOENT") {
      console.log(`skipped ${path} (already absent)`);
      skipped++;
    } else {
      console.error(`failed  ${path}: ${String(err)}`);
      process.exit(1);
    }
  }
}
console.log(`\nclean:state complete — removed ${removed}, skipped ${skipped}.`);
