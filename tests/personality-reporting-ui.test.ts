import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

const UI_PATH = join(process.cwd(), "ui", "index.html");
const uiHtml = readFileSync(UI_PATH, "utf-8");

function extractScript(): string {
  const match = uiHtml.match(/^<script>\n([\s\S]*?)\n<\/script>/m);
  assert.ok(match, "ui/index.html must contain a real <script> block");
  return match![1]!
    .replace(/\(async function bootstrap\(\)\{[\s\S]*?\}\)\(\);?\s*$/, "")
    .replace(/\nboot\(\);?\s*$/, "\n");
}

type UiCtx = {
  normalizeRunForDisplay: (run: unknown) => {
    personalityEvaluation: { category: string; raw_or_summary_reason: string; score_basis: string[] } | null;
  };
  shapeDrilldownExportRows: (tabKey: string, modelId: string) => Array<Record<string, unknown>>;
  state: {
    tabData: Record<string, { runs: unknown[] }>;
  };
};

function loadUi(): UiCtx {
  const sandbox: Record<string, unknown> = {
    console,
    window: {},
    document: { addEventListener: () => {}, body: { className: "" } },
    navigator: { userAgent: "node-test" },
    location: { pathname: "/", hash: "", search: "" },
    history: { replaceState: () => {} },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    fetch: () => Promise.reject(new Error("fetch is not stubbed")),
    EventSource: class {},
    Blob: class {},
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  const prelude = "function render(){}\n";
  const script = extractScript()
    .replace(/function render\(\)\{[\s\S]*?\n\}\n/, "/* render stubbed */\n")
    .replace(/async function runBatch\(tabKey,taskIds,modelIds,label\)\{[\s\S]*?\n\}\n/, "/* runBatch stubbed */\n");
  const exporter = "\n;globalThis.__ui={normalizeRunForDisplay,shapeDrilldownExportRows,state};\n";
  const context = vm.createContext(sandbox);
  vm.runInContext(prelude + script + exporter, context, { filename: "ui/index.html::script" });
  return (sandbox as { __ui: UiCtx }).__ui;
}

describe("ui personality reporting bindings", () => {
  it("binds personality_evaluation from API rows and summary payloads", () => {
    const ui = loadUi();
    const row = ui.normalizeRunForDisplay({
      bundle_id: "p1",
      task_id: "personality-002",
      model: "m",
      provider: "unit",
      score: 0,
      personality_evaluation: {
        category: "STYLE_MISMATCH",
        raw_or_summary_reason: "Corporate speak detected",
        score_basis: ["P2-Q1:fail:Corporate speak detected"],
      },
    });
    assert.equal(row.personalityEvaluation?.category, "STYLE_MISMATCH");

    const summary = ui.normalizeRunForDisplay({
      bundle_id: "p2",
      target: { model: "m", provider: "unit" },
      outcome: {
        score: 0,
        personality_evaluation: {
          category: "EMPTY_RESPONSE",
          raw_or_summary_reason: "Provider returned an empty response",
          score_basis: ["questions=0/1"],
        },
      },
    });
    assert.equal(summary.personalityEvaluation?.category, "EMPTY_RESPONSE");
  });

  it("includes personality category, reason, and score basis in drilldown exports", () => {
    const ui = loadUi();
    ui.state.tabData.personality = {
      runs: [{
        bundle_id: "p3",
        task_id: "personality-004",
        model: "persona-model",
        provider: "unit",
        score: 12,
        personality_evaluation: {
          category: "OVERDONE_ROLEPLAY",
          raw_or_summary_reason: "Roleplay displaced the task",
          score_basis: ["P4-Q2:fail:Response did not answer the task"],
        },
      }],
    };
    const rows = ui.shapeDrilldownExportRows("personality", "persona-model");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!["personality_category"], "OVERDONE_ROLEPLAY");
    assert.equal(rows[0]!["personality_reason"], "Roleplay displaced the task");
    assert.match(String(rows[0]!["personality_score_basis"]), /P4-Q2/);
  });
});
