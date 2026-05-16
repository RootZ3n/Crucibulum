/**
 * Crucible — export helpers and defensive data handling tests
 *
 * Tests the pure functions used for:
 *   - shapeExportRows: transforms reviewSummary rollups into export-ready rows
 *   - shapeModelDrilldown / shapeDrilldownExportRows: per-model run detail shaping
 *   - safeScore / safeStr / safeNum: defensive formatting helpers
 *   - CSV/JSON export shape correctness
 *   - view mode toggle persistence
 *   - graceful handling of empty, missing, and malformed data
 *
 * No mock leaderboard data — these tests seed state with known shapes
 * and verify the output never includes NaN, undefined, null strings,
 * or fabricated values.
 */
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

type ExportRow = {
  rank: number;
  model: string;
  provider: string;
  score: number;
  pass_rate: number;
  runs: number;
  critical_failure_rate: number;
  cost_avg: number | null;
  duration_avg_ms: number | null;
  sample_adequate: boolean;
  scope: string;
  scope_kind: string;
  lane: string;
  provisional: boolean;
};

type DrilldownRow = {
  runId: string;
  bundleHash: string;
  model: string;
  provider: string;
  score: number;
  pass: boolean;
  verdictLabel: string;
  verdictClass: string;
  isModelFailure: boolean;
  isInfraIssue: boolean;
  isCriticalFailure: boolean;
  task: string;
  family: string;
  lane: string;
  categorySummary: string;
  timestamp: string;
  evidenceSummary: string;
  hasReceipt: boolean;
  overallKnown: boolean;
};

type DrilldownExportRow = {
  index: number;
  run_id: string;
  bundle_hash: string | null;
  model: string;
  provider: string;
  score: number;
  pass: boolean;
  verdict: string;
  is_critical_failure: boolean;
  is_model_failure: boolean;
  is_infra_issue: boolean;
  task: string;
  family: string;
  lane: string;
  category_summary: string | null;
  timestamp: string | null;
  evidence_summary: string | null;
  has_receipt: boolean;
};

type LoadedUi = {
  state: {
    tabData: Record<string, unknown>;
    activeTab: string;
    resultsView: string;
    drilldownModel: string | null;
    drilldownPage: number;
    drilldownSort: string;
    focusedResult: Record<string, unknown>;
  };
  safeScore: (value: unknown) => number;
  safeStr: (value: unknown) => string;
  safeNum: (value: unknown) => number;
  shapeExportRows: (tabKey: string) => ExportRow[];
  shapeModelDrilldown: (tabKey: string, modelId: string, sortMode?: string) => DrilldownRow[];
  shapeDrilldownExportRows: (tabKey: string, modelId: string) => DrilldownExportRow[];
  drilldownVisibleSlice: (allRows: DrilldownRow[], page: number) => { visible: DrilldownRow[]; total: number; hasMore: boolean };
  exportFileName: (tabKey: string, ext: string) => string;
  setResultsView: (mode: string) => void;
  focusModelDrilldown: (tabKey: string, modelId: string) => void;
  clearModelDrilldown: () => void;
  drilldownShowMore: () => void;
  setDrilldownSort: (mode: string) => void;
  focusDrilldownRun: (tabKey: string, runId: string) => void;
  scorePct: (value: unknown) => number;
  laneScopeDescriptor: (tabKey: string) => { scopeLabel: string; kind: string; tabLabel: string; sampleSize: number; provisional: boolean };
  DRILLDOWN_PAGE_SIZE: number;
  DRILLDOWN_SORT_MODES: string[];
};

function loadUi(): LoadedUi {
  const script = extractScript();
  const locationStub = { pathname: "/", hash: "", search: "", origin: "http://localhost" };
  const windowStub: Record<string, unknown> = { location: locationStub };
  const lsMap = new Map<string, string>();
  const sandbox: Record<string, unknown> = {
    console,
    window: windowStub,
    document: { addEventListener: () => {}, body: { className: "" }, getElementById: () => null, querySelectorAll: () => [], createElement: () => ({ href: "", download: "", click: () => {}, style: {} }), },
    navigator: { userAgent: "node-test" },
    location: locationStub,
    history: { replaceState: () => {} },
    localStorage: {
      getItem: (k: string) => lsMap.get(k) ?? null,
      setItem: (k: string, v: string) => { lsMap.set(k, String(v)); },
      removeItem: (k: string) => { lsMap.delete(k); },
    },
    fetch: () => Promise.reject(new Error("fetch not stubbed")),
    EventSource: class {},
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    Headers: class {
      _h = new Map<string, string>();
      constructor(init?: Record<string, string>) {
        if (init) for (const k of Object.keys(init)) this._h.set(k.toLowerCase(), init[k]!);
      }
      has(k: string) { return this._h.has(k.toLowerCase()); }
      set(k: string, v: string) { this._h.set(k.toLowerCase(), v); }
      get(k: string) { return this._h.get(k.toLowerCase()); }
    },
  };
  sandbox.globalThis = sandbox;
  const prelude = "function render(){}\n";
  const withoutRender = script.replace(/function render\(\)\{[\s\S]*?\n\}\n/, "/* render stubbed */\n");
  const exporter = "\n;globalThis.__ui={state,safeScore,safeStr,safeNum,shapeExportRows,shapeModelDrilldown,shapeDrilldownExportRows,drilldownVisibleSlice,exportFileName,setResultsView,focusModelDrilldown,clearModelDrilldown,drilldownShowMore,setDrilldownSort,focusDrilldownRun,scorePct,laneScopeDescriptor,DRILLDOWN_PAGE_SIZE,DRILLDOWN_SORT_MODES};\n";
  const context = vm.createContext(sandbox);
  vm.runInContext(prelude + withoutRender + exporter, context, { filename: "ui/index.html::script" });
  return (sandbox as { __ui: LoadedUi }).__ui;
}

// ── defensive helpers ──────────────────────────────────────────────────────

describe("safeScore: defensive score formatting", () => {
  it("returns 0 for null, undefined, NaN, and non-numeric input", () => {
    const ui = loadUi();
    assert.equal(ui.safeScore(null), 0);
    assert.equal(ui.safeScore(undefined), 0);
    assert.equal(ui.safeScore(NaN), 0);
    assert.equal(ui.safeScore("garbage"), 0);
    assert.equal(ui.safeScore(Infinity), 0);
    assert.equal(ui.safeScore(-Infinity), 0);
  });

  it("normalizes decimal scores (0-1) to percentages", () => {
    const ui = loadUi();
    assert.equal(ui.safeScore(0.85), 85);
    assert.equal(ui.safeScore(0.0), 0);
    assert.equal(ui.safeScore(1.0), 100);
  });

  it("clamps to 0-100", () => {
    const ui = loadUi();
    assert.equal(ui.safeScore(-10), 0);
    assert.equal(ui.safeScore(200), 100);
  });

  it("rounds whole-number scores", () => {
    const ui = loadUi();
    assert.equal(ui.safeScore(87), 87);
    assert.equal(ui.safeScore(72.6), 73);
  });
});

describe("safeStr: defensive string formatting", () => {
  it("returns empty string for null, undefined, NaN", () => {
    const ui = loadUi();
    assert.equal(ui.safeStr(null), "");
    assert.equal(ui.safeStr(undefined), "");
    assert.equal(ui.safeStr(NaN), "");
  });

  it("converts 'undefined' and 'null' literals to empty string", () => {
    const ui = loadUi();
    assert.equal(ui.safeStr("undefined"), "");
    assert.equal(ui.safeStr("null"), "");
    assert.equal(ui.safeStr("NaN"), "");
  });

  it("passes through valid strings", () => {
    const ui = loadUi();
    assert.equal(ui.safeStr("glm-4"), "glm-4");
    assert.equal(ui.safeStr("claude-opus-4-6"), "claude-opus-4-6");
  });
});

describe("safeNum: defensive number formatting", () => {
  it("returns 0 for non-finite values", () => {
    const ui = loadUi();
    assert.equal(ui.safeNum(null), 0);
    assert.equal(ui.safeNum(undefined), 0);
    assert.equal(ui.safeNum(NaN), 0);
    assert.equal(ui.safeNum(Infinity), 0);
  });

  it("passes through valid numbers", () => {
    const ui = loadUi();
    assert.equal(ui.safeNum(42), 42);
    assert.equal(ui.safeNum(3.14), 3.14);
    assert.equal(ui.safeNum(0), 0);
  });
});

// ── export shaping ─────────────────────────────────────────────────────────

describe("shapeExportRows: export data shaping", () => {
  it("returns empty array when no runs exist", () => {
    const ui = loadUi();
    ui.state.tabData = {};
    const rows = ui.shapeExportRows("dashboard");
    assert.ok(Array.isArray(rows));
    assert.equal(rows.length, 0);
  });

  it("shapes leaderboard data into export rows with all required fields", () => {
    const ui = loadUi();
    ui.state.tabData = {
      benchmark: {
        runs: [
          { bundle_id: "r1", model: "glm-4", score: 87, pass: true, provider: "zai" },
          { bundle_id: "r2", model: "glm-4", score: 72, pass: false, provider: "zai" },
          { bundle_id: "r3", model: "gpt-5.4", score: 91, pass: true, provider: "openai" },
        ],
        leaderboard: [
          { model: "gpt-5.4", composite: 91, totalRuns: 1, average_pass_rate: 1.0, sample_adequate: false, ranking_eligible: true, model_failure_rate: 0 },
          { model: "glm-4", composite: 80, totalRuns: 2, average_pass_rate: 0.5, sample_adequate: true, ranking_eligible: true, model_failure_rate: 0.5 },
        ],
      },
    };
    const rows = ui.shapeExportRows("benchmark");
    assert.equal(rows.length, 2);
    // First row
    assert.equal(rows[0]!.rank, 1);
    assert.equal(rows[0]!.model, "gpt-5.4");
    assert.equal(rows[0]!.score, 91);
    assert.equal(rows[0]!.sample_adequate, false);
    assert.equal(rows[0]!.scope_kind, "lane");
    // Second row
    assert.equal(rows[1]!.rank, 2);
    assert.equal(rows[1]!.model, "glm-4");
    assert.equal(rows[1]!.score, 80);
    assert.equal(rows[1]!.sample_adequate, true);
  });

  it("never produces NaN, undefined, or null in string fields", () => {
    const ui = loadUi();
    ui.state.tabData = {
      dashboard: {
        runs: [
          { bundle_id: "r1", model: null, score: undefined, pass: null, provider: undefined },
        ],
      },
    };
    const rows = ui.shapeExportRows("dashboard");
    for (const row of rows) {
      assert.notEqual(row.model, "undefined");
      assert.notEqual(row.model, "null");
      assert.notEqual(row.model, "NaN");
      assert.notEqual(row.provider, "undefined");
      assert.notEqual(row.provider, "null");
      assert.ok(Number.isFinite(row.score), `score must be finite, got ${row.score}`);
      assert.ok(Number.isFinite(row.pass_rate), `pass_rate must be finite, got ${row.pass_rate}`);
      assert.ok(Number.isFinite(row.runs), `runs must be finite, got ${row.runs}`);
      assert.ok(Number.isFinite(row.critical_failure_rate), `critical_failure_rate must be finite, got ${row.critical_failure_rate}`);
    }
  });

  it("includes scope and lane metadata in every row", () => {
    const ui = loadUi();
    ui.state.tabData = {
      safety: {
        runs: [{ bundle_id: "s1", model: "glm-4", score: 90, pass: true }],
        leaderboard: [{ model: "glm-4", composite: 90, totalRuns: 1, average_pass_rate: 1.0, sample_adequate: true, ranking_eligible: true, model_failure_rate: 0 }],
      },
    };
    const rows = ui.shapeExportRows("safety");
    assert.equal(rows.length, 1);
    assert.ok(rows[0]!.scope.length > 0, "scope must be non-empty");
    assert.equal(rows[0]!.scope_kind, "lane");
    assert.ok(rows[0]!.lane.length > 0, "lane must be non-empty");
  });
});

// ── export file name ───────────────────────────────────────────────────────

describe("exportFileName: file naming", () => {
  it("includes crucible prefix, lane, and timestamp", () => {
    const ui = loadUi();
    const name = ui.exportFileName("dashboard", "json");
    assert.match(name, /^crucible-/, "must start with crucible-");
    assert.match(name, /\.json$/, "must end with .json");
    // Should contain a timestamp-like pattern
    assert.match(name, /\d{4}-\d{2}-\d{2}/, "must contain date");
  });

  it("sanitizes lane name for file safety", () => {
    const ui = loadUi();
    const name = ui.exportFileName("benchmark", "csv");
    assert.match(name, /^crucible-benchmark-/, "benchmark lane in filename");
    assert.match(name, /\.csv$/, "must end with .csv");
    // No spaces or special chars (T from ISO timestamp is acceptable)
    assert.ok(!/[^a-zA-Z0-9\-.]/.test(name), `filename must be safe: ${name}`);
  });
});

// ── view mode toggle ───────────────────────────────────────────────────────

describe("setResultsView: view mode state management", () => {
  it("sets valid view modes", () => {
    const ui = loadUi();
    ui.setResultsView("table");
    assert.equal(ui.state.resultsView, "table");
    ui.setResultsView("chart");
    assert.equal(ui.state.resultsView, "chart");
    ui.setResultsView("simple");
    assert.equal(ui.state.resultsView, "simple");
  });

  it("rejects invalid view modes and defaults to simple", () => {
    const ui = loadUi();
    ui.setResultsView("nonsense");
    assert.equal(ui.state.resultsView, "simple");
    ui.setResultsView("");
    assert.equal(ui.state.resultsView, "simple");
  });
});

// ── model drilldown data shaping ───────────────────────────────────────────

describe("shapeModelDrilldown: per-model run detail shaping", () => {
  it("returns empty array for unknown model", () => {
    const ui = loadUi();
    ui.state.tabData = {
      dashboard: { runs: [{ bundle_id: "r1", model: "glm-4", score: 80, pass: true }] },
    };
    const rows = ui.shapeModelDrilldown("dashboard", "nonexistent-model");
    assert.ok(Array.isArray(rows));
    assert.equal(rows.length, 0);
  });

  it("returns empty array for empty modelId", () => {
    const ui = loadUi();
    ui.state.tabData = { dashboard: { runs: [{ bundle_id: "r1", model: "glm-4", score: 80 }] } };
    const rows = ui.shapeModelDrilldown("dashboard", "");
    assert.equal(rows.length, 0);
  });

  it("filters runs by model (case insensitive)", () => {
    const ui = loadUi();
    ui.state.tabData = {
      dashboard: {
        runs: [
          { bundle_id: "r1", model: "GLM-4", score: 87, pass: true, provider: "zai", timestamp: "2026-04-15T00:00:00Z" },
          { bundle_id: "r2", model: "gpt-5.4", score: 91, pass: true, provider: "openai" },
          { bundle_id: "r3", model: "glm-4", score: 72, pass: false, provider: "zai", timestamp: "2026-04-16T00:00:00Z" },
        ],
      },
    };
    const rows = ui.shapeModelDrilldown("dashboard", "glm-4");
    assert.equal(rows.length, 2, "should find both GLM-4 and glm-4");
    assert.ok(rows.every(r => r.model.toLowerCase().includes("glm-4")));
  });

  it("produces well-formed drilldown rows with no undefined/NaN fields", () => {
    const ui = loadUi();
    ui.state.tabData = {
      dashboard: {
        runs: [
          {
            bundle_id: "b1",
            model: "glm-4",
            score: 42,
            pass: false,
            provider: "zai",
            bundle_hash: "abc123def456",
            timestamp: "2026-04-15T12:00:00Z",
          },
        ],
      },
    };
    const rows = ui.shapeModelDrilldown("dashboard", "glm-4");
    assert.equal(rows.length, 1);
    const r = rows[0]!;
    assert.equal(r.score, 42);
    assert.equal(r.pass, false);
    assert.equal(r.isCriticalFailure, true, "score < 55 is critical");
    assert.equal(r.hasReceipt, true, "bundle_hash present");
    assert.ok(r.bundleHash.length > 0);
    // No undefined/NaN in any string field
    assert.notEqual(r.model, "undefined");
    assert.notEqual(r.provider, "undefined");
    assert.notEqual(r.verdictLabel, "undefined");
    assert.ok(Number.isFinite(r.score));
  });

  it("handles runs with missing/null fields gracefully", () => {
    const ui = loadUi();
    ui.state.tabData = {
      dashboard: {
        runs: [
          { bundle_id: "m1", model: "test-model", score: null, pass: null, provider: null, bundle_hash: null, timestamp: undefined },
        ],
      },
    };
    const rows = ui.shapeModelDrilldown("dashboard", "test-model");
    assert.equal(rows.length, 1);
    const r = rows[0]!;
    assert.equal(r.score, 0, "null score becomes 0");
    assert.equal(r.pass, false, "null pass becomes false");
    assert.equal(r.hasReceipt, false, "null hash means no receipt");
    assert.notEqual(r.provider, "null");
    assert.notEqual(r.timestamp, "undefined");
    assert.ok(Number.isFinite(r.score));
  });
});

describe("shapeDrilldownExportRows: drilldown export shaping", () => {
  it("returns empty array for no matching runs", () => {
    const ui = loadUi();
    ui.state.tabData = {};
    const rows = ui.shapeDrilldownExportRows("dashboard", "any-model");
    assert.ok(Array.isArray(rows));
    assert.equal(rows.length, 0);
  });

  it("exports all required fields with no undefined string values", () => {
    const ui = loadUi();
    ui.state.tabData = {
      dashboard: {
        runs: [
          { bundle_id: "b1", model: "glm-4", score: 87, pass: true, provider: "zai", bundle_hash: "hash1", timestamp: "2026-04-15T00:00:00Z" },
          { bundle_id: "b2", model: "glm-4", score: 45, pass: false, provider: "zai" },
        ],
      },
    };
    const rows = ui.shapeDrilldownExportRows("dashboard", "glm-4");
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.ok(Number.isFinite(row.index));
      assert.ok(typeof row.run_id === "string");
      assert.ok(typeof row.model === "string");
      assert.ok(typeof row.provider === "string");
      assert.ok(Number.isFinite(row.score));
      assert.ok(typeof row.pass === "boolean");
      assert.ok(typeof row.verdict === "string");
      assert.ok(typeof row.is_critical_failure === "boolean");
      assert.ok(typeof row.has_receipt === "boolean");
      // No "undefined" or "null" in strings
      assert.notEqual(row.model, "undefined");
      assert.notEqual(row.verdict, "undefined");
      assert.notEqual(row.run_id, "undefined");
    }
    // First row has receipt, second doesn't
    assert.equal(rows[0]!.has_receipt, true);
    // Check critical failure detection
    const critRow = rows.find(r => r.score < 55);
    assert.ok(critRow, "should have a critical failure row");
    assert.equal(critRow!.is_critical_failure, true);
  });

  it("includes lane and scope metadata", () => {
    const ui = loadUi();
    ui.state.tabData = {
      safety: {
        runs: [{ bundle_id: "s1", model: "glm-4", score: 90, pass: true }],
      },
    };
    const rows = ui.shapeDrilldownExportRows("safety", "glm-4");
    assert.equal(rows.length, 1);
    assert.ok(rows[0]!.lane.length > 0, "lane must be non-empty");
  });

  it("exports tiered verdict labels rather than absolute fail wording for mostly successful runs", () => {
    const ui = loadUi();
    ui.state.tabData = {
      dashboard: {
        runs: [{
          bundle_id: "p1",
          model: "glm-4",
          provider: "zai",
          score: 81,
          pass: false,
          verdict: { completionState: "FAIL", failureOrigin: "MODEL", failureReasonSummary: "3 ordinary misses" },
        }],
      },
    };
    const rows = ui.shapeDrilldownExportRows("dashboard", "glm-4");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.verdict, "PARTIAL_PASS");
    assert.equal(rows[0]!.is_model_failure, true);
  });
});

describe("focusModelDrilldown / clearModelDrilldown: state management", () => {
  it("sets and clears drilldown model and resets page/sort", () => {
    const ui = loadUi();
    ui.focusModelDrilldown("dashboard", "glm-4");
    assert.equal(ui.state.drilldownModel, "glm-4");
    assert.equal(ui.state.drilldownPage, 1);
    ui.clearModelDrilldown();
    assert.equal(ui.state.drilldownModel, null);
    assert.equal(ui.state.drilldownPage, 1);
    assert.equal(ui.state.drilldownSort, "newest");
  });

  it("handles empty model gracefully", () => {
    const ui = loadUi();
    ui.focusModelDrilldown("dashboard", "");
    assert.equal(ui.state.drilldownModel, "");
    ui.state.tabData = { dashboard: { runs: [{ bundle_id: "r1", model: "glm-4", score: 80 }] } };
    const rows = ui.shapeModelDrilldown("dashboard", "");
    assert.equal(rows.length, 0);
  });
});

// ── pagination ─────────────────────────────────────────────────────────────

describe("drilldownVisibleSlice: pagination", () => {
  function makeRows(n: number): DrilldownRow[] {
    return Array.from({ length: n }, (_, i) => ({
      runId: `r${i}`, bundleHash: "", model: "m", provider: "p", score: 80,
      pass: true, verdictLabel: "PASS", verdictClass: "pass", isModelFailure: false,
      isInfraIssue: false, isCriticalFailure: false, task: "t", family: "f",
      lane: "l", categorySummary: "", timestamp: "", evidenceSummary: "",
      hasReceipt: false, overallKnown: true,
    }));
  }

  it("returns all rows when under page size", () => {
    const ui = loadUi();
    const rows = makeRows(10);
    const result = ui.drilldownVisibleSlice(rows, 1);
    assert.equal(result.visible.length, 10);
    assert.equal(result.total, 10);
    assert.equal(result.hasMore, false);
  });

  it("paginates at DRILLDOWN_PAGE_SIZE boundary", () => {
    const ui = loadUi();
    const rows = makeRows(60);
    const p1 = ui.drilldownVisibleSlice(rows, 1);
    assert.equal(p1.visible.length, ui.DRILLDOWN_PAGE_SIZE);
    assert.equal(p1.hasMore, true);
    assert.equal(p1.total, 60);

    const p2 = ui.drilldownVisibleSlice(rows, 2);
    assert.equal(p2.visible.length, ui.DRILLDOWN_PAGE_SIZE * 2);
    assert.equal(p2.hasMore, true);

    const p3 = ui.drilldownVisibleSlice(rows, 3);
    assert.equal(p3.visible.length, 60);
    assert.equal(p3.hasMore, false);
  });

  it("handles page=0 and negative gracefully", () => {
    const ui = loadUi();
    const rows = makeRows(30);
    const result = ui.drilldownVisibleSlice(rows, 0);
    assert.equal(result.visible.length, ui.DRILLDOWN_PAGE_SIZE);
  });
});

describe("drilldownShowMore: increments page", () => {
  it("increments drilldownPage", () => {
    const ui = loadUi();
    assert.equal(ui.state.drilldownPage, 1);
    ui.drilldownShowMore();
    assert.equal(ui.state.drilldownPage, 2);
    ui.drilldownShowMore();
    assert.equal(ui.state.drilldownPage, 3);
  });
});

// ── sort modes ─────────────────────────────────────────────────────────────

describe("setDrilldownSort: sort state management", () => {
  it("sets valid sort modes and resets page", () => {
    const ui = loadUi();
    ui.state.drilldownPage = 3;
    ui.setDrilldownSort("lowest");
    assert.equal(ui.state.drilldownSort, "lowest");
    assert.equal(ui.state.drilldownPage, 1, "page resets on sort change");
    ui.setDrilldownSort("critical");
    assert.equal(ui.state.drilldownSort, "critical");
    ui.setDrilldownSort("newest");
    assert.equal(ui.state.drilldownSort, "newest");
  });

  it("rejects invalid sort and defaults to newest", () => {
    const ui = loadUi();
    ui.setDrilldownSort("garbage");
    assert.equal(ui.state.drilldownSort, "newest");
  });
});

describe("shapeModelDrilldown sort modes", () => {
  it("sorts by newest (timestamp desc) by default", () => {
    const ui = loadUi();
    ui.state.tabData = {
      dashboard: {
        runs: [
          { bundle_id: "old", model: "m", score: 90, timestamp: "2026-01-01T00:00:00Z" },
          { bundle_id: "new", model: "m", score: 60, timestamp: "2026-06-01T00:00:00Z" },
          { bundle_id: "mid", model: "m", score: 75, timestamp: "2026-03-01T00:00:00Z" },
        ],
      },
    };
    const rows = ui.shapeModelDrilldown("dashboard", "m", "newest");
    assert.equal(rows[0]!.runId, "new");
    assert.equal(rows[2]!.runId, "old");
  });

  it("sorts by lowest score first", () => {
    const ui = loadUi();
    ui.state.tabData = {
      dashboard: {
        runs: [
          { bundle_id: "a", model: "m", score: 90, timestamp: "2026-01-01T00:00:00Z" },
          { bundle_id: "b", model: "m", score: 40, timestamp: "2026-02-01T00:00:00Z" },
          { bundle_id: "c", model: "m", score: 70, timestamp: "2026-03-01T00:00:00Z" },
        ],
      },
    };
    const rows = ui.shapeModelDrilldown("dashboard", "m", "lowest");
    assert.equal(rows[0]!.score, 40, "lowest score first");
    assert.equal(rows[1]!.score, 70);
    assert.equal(rows[2]!.score, 90);
  });

  it("sorts critical failures first", () => {
    const ui = loadUi();
    ui.state.tabData = {
      dashboard: {
        runs: [
          { bundle_id: "good", model: "m", score: 95, timestamp: "2026-01-01T00:00:00Z" },
          { bundle_id: "crit", model: "m", score: 30, timestamp: "2026-02-01T00:00:00Z" },
          { bundle_id: "ok", model: "m", score: 70, timestamp: "2026-03-01T00:00:00Z" },
        ],
      },
    };
    const rows = ui.shapeModelDrilldown("dashboard", "m", "critical");
    assert.equal(rows[0]!.isCriticalFailure, true, "critical failure first");
    assert.equal(rows[0]!.runId, "crit");
  });
});

// ── focusDrilldownRun: reuses existing focused-run path ────────────────────

describe("focusDrilldownRun: wires into existing setFocusedRun", () => {
  it("sets focusedResult for dashboard via existing path", () => {
    const ui = loadUi();
    ui.state.tabData = {
      dashboard: {
        runs: [
          { bundle_id: "b1", model: "glm-4", score: 87, pass: true, provider: "zai" },
          { bundle_id: "b2", model: "gpt-5.4", score: 91, pass: true, provider: "openai" },
        ],
      },
    };
    ui.focusDrilldownRun("dashboard", "b1");
    const focused = ui.state.focusedResult.dashboard as Record<string, unknown> | undefined;
    assert.ok(focused, "focusedResult.dashboard must be set");
    assert.equal(focused!.runId, "b1");
    assert.equal((focused as { overall?: number }).overall, 87);
  });

  it("sets focusedResult for lane tab via existing path", () => {
    const ui = loadUi();
    ui.state.tabData = {
      benchmark: {
        runs: [
          { bundle_id: "bm1", model: "glm-4", score: 72, pass: false, provider: "zai" },
        ],
      },
    };
    ui.focusDrilldownRun("benchmark", "bm1");
    const focused = ui.state.focusedResult.benchmark as Record<string, unknown> | undefined;
    assert.ok(focused, "focusedResult.benchmark must be set");
    assert.equal(focused!.runId, "bm1");
  });

  it("does not crash when run ID is not found", () => {
    const ui = loadUi();
    ui.state.tabData = { dashboard: { runs: [] } };
    // Should not throw
    ui.focusDrilldownRun("dashboard", "nonexistent");
    assert.equal(ui.state.focusedResult.dashboard, undefined);
  });
});
