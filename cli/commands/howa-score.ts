import { resolve } from "node:path";
import { loadImportedHowaResults, projectHowaScoreboard, writeHowaCampaignSnapshot } from "../../core/howa-daily-driver-scoring.js";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function howaScoreCommand(args: string[]): Promise<void> {
  const store = option(args, "--store");
  if (!store) throw new Error("Usage: luak howa-score --store <dir> [--campaign-id <id>]");
  const rows = projectHowaScoreboard(loadImportedHowaResults(resolve(store)));
  const campaignId = option(args, "--campaign-id");
  if (campaignId) process.stdout.write(`campaign_snapshot=${writeHowaCampaignSnapshot(resolve(store), campaignId, rows)}\n`);
  process.stdout.write(`${JSON.stringify({ schema_version: "luak.howa-scoreboard.v2", rows }, null, 2)}\n`);
}
