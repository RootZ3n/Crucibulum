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
    buildEvaluation: { category: string; raw_or_summary_reason: string; score_basis: string[] } | null;
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

describe("ui build reporting bindings", () => {
  it("binds build_evaluation from API rows and summary payloads", () => {
    const ui = loadUi();
    const row = ui.normalizeRunForDisplay({
      bundle_id: "b1",
      task_id: "coord-001",
      family: "orchestration",
      model: "m",
      provider: "unit",
      score: 0,
      build_evaluation: {
        category: "NO_EDIT",
        raw_or_summary_reason: "No repository files changed",
        score_basis: ["files_changed=0"],
      },
    });
    assert.equal(row.buildEvaluation?.category, "NO_EDIT");

    const summary = ui.normalizeRunForDisplay({
      bundle_id: "b2",
      target: { model: "m", provider: "unit" },
      outcome: {
        score: 0,
        build_evaluation: {
          category: "PREEXISTING_REPO_FAILURE",
          raw_or_summary_reason: "pre-agent baseline failed",
          score_basis: ["correctness:public:fail:cmd=npm run build"],
        },
      },
    });
    assert.equal(summary.buildEvaluation?.category, "PREEXISTING_REPO_FAILURE");
  });

  it("includes build category, reason, and score basis in drilldown exports", () => {
    const ui = loadUi();
    ui.state.tabData.build = {
      runs: [{
        bundle_id: "b3",
        task_id: "coord-002",
        family: "orchestration",
        model: "build-model",
        provider: "unit",
        score: 12,
        build_evaluation: {
          category: "BUILD_FAILED",
          raw_or_summary_reason: "TypeScript compile failed after agent edit",
          score_basis: ["correctness:public:fail:exit=2:cmd=npm run build"],
        },
      }],
    };
    const rows = ui.shapeDrilldownExportRows("build", "build-model");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!["build_category"], "BUILD_FAILED");
    assert.equal(rows[0]!["build_reason"], "TypeScript compile failed after agent edit");
    assert.match(String(rows[0]!["build_score_basis"]), /npm run build/);
  });
});
