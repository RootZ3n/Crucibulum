import { resolve } from "node:path";
import { importHowaReceipt } from "../../core/howa-daily-driver.js";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function howaImportCommand(args: string[]): Promise<void> {
  const store = option(args, "--store");
  const evidence = option(args,"--evidence-root");
  const sources = args.filter((value, index) => !value.startsWith("--") && !["--store","--evidence-root"].includes(args[index - 1]??""));
  if (!store || !evidence || sources.length === 0) throw new Error("Usage: luak howa-import <receipt.json...> --store <dir> --evidence-root <dir>");
  for (const source of sources) {
    const result = importHowaReceipt(resolve(source), resolve(store), resolve(evidence));
    process.stdout.write(`${result.receipt.receipt_digest}\t${result.receipt.raw_verdict}\t${result.raw_path}\n`);
  }
}
