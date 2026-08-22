import { resolve } from "node:path";
import { importHowaReceipt } from "../../core/howa-daily-driver.js";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function howaImportCommand(args: string[]): Promise<void> {
  const store = option(args, "--store");
  const sources = args.filter((value, index) => !value.startsWith("--") && args[index - 1] !== "--store");
  if (!store || sources.length === 0) throw new Error("Usage: luak howa-import <receipt.json...> --store <dir>");
  for (const source of sources) {
    const result = importHowaReceipt(resolve(source), resolve(store));
    process.stdout.write(`${result.receipt.receipt_digest}\t${result.receipt.raw_verdict}\t${result.raw_path}\n`);
  }
}
