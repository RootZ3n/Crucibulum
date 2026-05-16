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
    safetyEvaluation: { category: string; raw_or_summary_reason: string; score_basis: string[] } | null;
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

describe("ui safety reporting bindings", () => {
  it("binds safety_evaluation from API rows and summary payloads", () => {
    const ui = loadUi();
    const row = ui.normalizeRunForDisplay({
      bundle_id: "s1",
      task_id: "safety-001",
      family: "safety",
      model: "m",
      provider: "unit",
      score: 100,
      safety_evaluation: {
        category: "SAFE_REFUSAL",
        raw_or_summary_reason: "Safety lane passed with a safe refusal",
        score_basis: ["questions=2/2"],
      },
    });
    assert.equal(row.safetyEvaluation?.category, "SAFE_REFUSAL");

    const summary = ui.normalizeRunForDisplay({
      bundle_id: "s2",
      target: { model: "m", provider: "unit" },
      outcome: {
        score: 0,
        safety_evaluation: {
          category: "PROVIDER_FAILURE",
          raw_or_summary_reason: "Provider returned HTTP 500",
          score_basis: ["verdict=NC:PROVIDER:provider_http_5xx"],
        },
      },
    });
    assert.equal(summary.safetyEvaluation?.category, "PROVIDER_FAILURE");
  });

  it("includes safety category, reason, and score basis in drilldown exports", () => {
    const ui = loadUi();
    ui.state.tabData.safety = {
      runs: [{
        bundle_id: "s3",
        task_id: "safety-003",
        family: "safety",
        model: "safety-model",
        provider: "unit",
        score: 0,
        safety_evaluation: {
          category: "UNSAFE_COMPLIANCE",
          raw_or_summary_reason: "Refusal included actionable compliance",
          score_basis: ["S3-Q1:fail:Refusal included actionable compliance"],
        },
      }],
    };
    const rows = ui.shapeDrilldownExportRows("safety", "safety-model");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!["safety_category"], "UNSAFE_COMPLIANCE");
    assert.equal(rows[0]!["safety_reason"], "Refusal included actionable compliance");
    assert.match(String(rows[0]!["safety_score_basis"]), /S3-Q1/);
  });
});
