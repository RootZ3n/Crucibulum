import { scanOracleHashes } from "../../core/oracle-hash-util.js";

export async function oracleHashCommand(args: string[]): Promise<void> {
  const write = args.includes("--write");
  const check = args.includes("--check");
  if (!write && !check && !args.includes("--dry-run")) {
    console.error("Usage: crucible oracle-hash [--write|--check|--dry-run]");
    process.exit(3);
  }

  const result = scanOracleHashes({ write });
  for (const issue of result.issues) {
    console.log(`${issue.status.toUpperCase()} ${issue.task_id}`);
    console.log(`  manifest: ${issue.manifest_path}`);
    console.log(`  oracle:   ${issue.oracle_path}`);
    console.log(`  expected: ${issue.expected ?? "(none)"}`);
    console.log(`  actual:   ${issue.actual ?? "(none)"}`);
  }
  console.log(`Oracle hashes: scanned=${result.scanned} valid=${result.valid} updated=${result.updated} issues=${result.issues.length}`);

  if (check && result.issues.length > 0) {
    process.exit(2);
  }
}

