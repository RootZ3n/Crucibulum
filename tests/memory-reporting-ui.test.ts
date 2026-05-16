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
    memoryEvaluation: { category: string; raw_or_summary_reason: string; score_basis: string[] } | null;
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

describe("ui memory reporting bindings", () => {
  it("binds memory_evaluation from API rows and summary payloads", () => {
    const ui = loadUi();
    const row = ui.normalizeRunForDisplay({
      bundle_id: "m1",
      task_id: "memory-001",
      family: "memory",
      model: "m",
      provider: "unit",
      score: 100,
      memory_evaluation: {
        category: "PASS",
        raw_or_summary_reason: "Memory lane passed recall checks",
        score_basis: ["memory_operation=recall"],
      },
    });
    assert.equal(row.memoryEvaluation?.category, "PASS");

    const summary = ui.normalizeRunForDisplay({
      bundle_id: "m2",
      target: { model: "m", provider: "unit" },
      outcome: {
        score: 0,
        memory_evaluation: {
          category: "PROVIDER_FAILURE",
          raw_or_summary_reason: "Provider returned HTTP 500",
          score_basis: ["verdict=NC:PROVIDER:provider_http_5xx"],
        },
      },
    });
    assert.equal(summary.memoryEvaluation?.category, "PROVIDER_FAILURE");
  });

  it("includes memory category, reason, and score basis in drilldown exports", () => {
    const ui = loadUi();
    ui.state.tabData.memory = {
      runs: [{
        bundle_id: "m3",
        task_id: "memory-003",
        family: "memory",
        model: "memory-model",
        provider: "unit",
        score: 0,
        memory_evaluation: {
          category: "UPDATE_FAILURE",
          raw_or_summary_reason: "old value retained",
          score_basis: ["memory_operation=update", "M3-Q1:fail:old value retained"],
        },
      }],
    };
    const rows = ui.shapeDrilldownExportRows("memory", "memory-model");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!["memory_category"], "UPDATE_FAILURE");
    assert.equal(rows[0]!["memory_reason"], "old value retained");
    assert.match(String(rows[0]!["memory_score_basis"]), /memory_operation=update/);
  });
});
