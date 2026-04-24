/**
 * Crucible — MiniMax routing / clarity regression tests
 *
 * Pins three load-bearing facts the operator needs:
 *
 * 1. The curated MiniMax model list contains only ids MiniMax actually
 *    recognizes. A stale placeholder ("MiniMax-M2.7-her") made every run
 *    fail with 2013 "unknown model"; we now ship ids from MiniMax's public
 *    ChatCompletion v2 catalog and pin "no placeholder M2.7* survives".
 *
 * 2. MiniMax models in the curated list route DIRECTLY through the minimax
 *    adapter. Crucible is a standalone product and must not silently depend
 *    on the Squidley gateway for MiniMax runs.
 *
 * 3. When the UI dispatches a curated MiniMax model, the provider hint stays
 *    `minimax` and the adapter stays `minimax`, so a user-configured direct
 *    MiniMax key is the only path involved.
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
  return match![1]!.replace(/\(async function bootstrap\(\)\{[\s\S]*?\}\)\(\);?\s*$/, "");
}

type ModelGroup = { key: string; label: string; providerId: string; adapterId: string; models: Array<{ id: string; label: string }> };
type Ui = {
  DEFAULT_MODEL_GROUPS: ModelGroup[];
  deriveRoutingForModel: (id: string) => { providerId: string; adapterId: string; kind: string };
  mergedModelGroups?: () => ModelGroup[];
  reconcileTabSelection?: (tabKey: string, tabState: Record<string, unknown>) => Record<string, unknown>;
  state?: Record<string, unknown>;
  diagnoseReasonHint?: (reason: string, modelId: string) => string | null;
};

function loadUi(): Ui {
  const script = extractScript();
  const locationStub = { pathname: "/", hash: "", search: "", origin: "http://localhost" };
  const windowStub: Record<string, unknown> = { location: locationStub };
  const sandbox: Record<string, unknown> = {
    console,
    window: windowStub,
    document: { addEventListener: () => {}, body: { className: "" }, getElementById: () => null },
    navigator: { userAgent: "node-test" },
    location: locationStub,
    history: { replaceState: () => {} },
    localStorage: (() => { const s = new Map<string, string>(); return { getItem: (k: string) => s.get(k) ?? null, setItem: (k: string, v: string) => { s.set(k, String(v)); }, removeItem: (k: string) => { s.delete(k); } }; })(),
    fetch: () => Promise.reject(new Error("fetch not stubbed")),
    EventSource: class {},
    setTimeout, clearTimeout, URL, URLSearchParams,
    Headers: class { _h = new Map<string, string>(); constructor(init?: Record<string, string>) { if (init) for (const k of Object.keys(init)) this._h.set(k.toLowerCase(), init[k]!); } has(k: string) { return this._h.has(k.toLowerCase()); } set(k: string, v: string) { this._h.set(k.toLowerCase(), v); } get(k: string) { return this._h.get(k.toLowerCase()); } },
  };
  (sandbox as { globalThis: unknown }).globalThis = sandbox;
  const prelude = "function render(){}\n";
  const withoutRender = script.replace(/function render\(\)\{[\s\S]*?\n\}\n/, "/* render stubbed */\n");
  const exporter = "\n;globalThis.__ui={DEFAULT_MODEL_GROUPS,deriveRoutingForModel,mergedModelGroups,reconcileTabSelection,state,diagnoseReasonHint};\n";
  const context = vm.createContext(sandbox);
  vm.runInContext(prelude + withoutRender + exporter, context, { filename: "ui/index.html::script" });
  return (sandbox as { __ui: Ui }).__ui;
}

describe("MiniMax model catalog: no placeholder ids survive", () => {
  it("no curated MiniMax model carries an M2.7 placeholder id — those are fictional and MiniMax returns 2013 unknown-model", () => {
    const ui = loadUi();
    const all = ui.DEFAULT_MODEL_GROUPS.flatMap((g) => g.models.map((m) => m.id));
    const placeholders = all.filter((id) => /minimax-m2\.7/i.test(id));
    // deepEqual would trip on the vm cross-realm Array prototype; length
    // is the real assertion here.
    assert.equal(placeholders.length, 0, `placeholder MiniMax ids must never ship: found ${placeholders.join(",") || "(none reported)"}`);
  });

  it("the curated MiniMax group ships at least one recognized id", () => {
    const ui = loadUi();
    const minimaxGroup = ui.DEFAULT_MODEL_GROUPS.find((g) => g.key === "minimax");
    assert.ok(minimaxGroup, "there must be a MiniMax group (the operator's main workflow)");
    assert.ok(minimaxGroup!.models.length > 0, "MiniMax group must not ship empty — the operator needs runnable defaults");
    // At least one of the well-documented abab family must be present; this
    // keeps the list from drifting back into fully-empty or fully-made-up.
    const knownIds = new Set(["abab6.5s-chat", "abab6.5g-chat", "abab6.5-chat", "abab5.5-chat", "MiniMax-Text-01"]);
    const knownPresent = minimaxGroup!.models.some((m) => knownIds.has(m.id));
    assert.ok(knownPresent, "at least one MiniMax ChatCompletion v2 id must be in the curated list");
  });
});

describe("MiniMax routing: direct path is the default", () => {
  it("the curated 'minimax' group dispatches through the direct MiniMax adapter", () => {
    const ui = loadUi();
    const minimaxGroup = ui.DEFAULT_MODEL_GROUPS.find((g) => g.key === "minimax");
    assert.ok(minimaxGroup);
    assert.equal(minimaxGroup!.adapterId, "minimax", "MiniMax in Crucible must route directly, not through Squidley");
    assert.equal(minimaxGroup!.providerId, "minimax", "provider hint must stay minimax for the direct adapter");
  });

  it("deriveRoutingForModel returns minimax+minimax for a curated MiniMax id", () => {
    const ui = loadUi();
    const routing = ui.deriveRoutingForModel("abab6.5s-chat");
    assert.equal(routing.adapterId, "minimax", "a curated MiniMax id must route directly");
    assert.equal(routing.providerId, "minimax", "the provider hint must stay minimax");
  });

  it("uses registered MiniMax inventory instead of the curated fallback when a MiniMax provider is configured", () => {
    const ui = loadUi();
    assert.ok(ui.state && ui.mergedModelGroups && ui.reconcileTabSelection);
    ui.state!.registry = {
      presets: [],
      providers: [{ id: "prov-mini", presetId: "minimax", label: "MiniMax Direct", enabled: true }],
      models: [{ id: "mdl-mini", providerConfigId: "prov-mini", modelId: "abab6.5s-chat", displayName: "abab6.5s-chat", enabled: true }],
      catalog: [{
        providerConfigId: "prov-mini",
        providerLabel: "MiniMax Direct",
        presetId: "minimax",
        presetLabel: "MiniMax Direct",
        adapter: "minimax",
        kind: "cloud",
        modelEntryId: "mdl-mini",
        modelId: "abab6.5s-chat",
        displayName: "abab6.5s-chat",
        tags: [],
        enabled: true,
        providerEnabled: true,
      }],
    };
    const minimaxGroup = ui.mergedModelGroups!().find((g) => g.key === "minimax");
    assert.ok(minimaxGroup);
    // Cross-realm fix: arrays returned from inside vm.createContext carry the
    // sandbox's Array.prototype, which makes node:test's deepStrictEqual
    // fail even when the contents match. Copy into a host-realm array via
    // [...iterable] before comparing — same convention used elsewhere in
    // these UI tests (see ui-benchmark-bindings.test.ts).
    const groupModelIds = [...minimaxGroup!.models.map((m) => m.id)];
    assert.deepEqual(groupModelIds, ["abab6.5s-chat"], "registered MiniMax inventory must replace unsupported curated fallbacks");

    const reconciled = ui.reconcileTabSelection!("personality", { selectedTask: "", selectedTasks: [], selectedModels: ["abab5.5-chat"] });
    const reconciledModels = [...((reconciled as { selectedModels: string[] }).selectedModels)];
    assert.deepEqual(reconciledModels, ["abab6.5s-chat"], "stale invalid MiniMax selections must be replaced by a registered model");
  });
});

describe("unknown-model hint surfaces actionable next step", () => {
  it("diagnoseReasonHint recognizes 'unknown model' and points at the Providers tab", () => {
    const ui = loadUi();
    assert.ok(typeof ui.diagnoseReasonHint === "function");
    const hint = ui.diagnoseReasonHint!(
      "Invalid provider payload — MiniMax error 2013: invalid params, code: 2013, msg: unknown model 'minimax-m2.7-her'",
      "MiniMax-M2.7-her",
    );
    assert.ok(hint, "unknown-model error must yield a hint — operator can't debug 'Invalid provider payload' alone");
    assert.match(hint!, /Providers tab/i, "hint must name the exact UI surface the operator should open");
    assert.match(hint!, /MiniMax-M2\.7-her/, "hint must echo the unrecognized id so the operator knows which one to fix");
  });

  it("diagnoseReasonHint stays quiet on failures we don't have a specific fix for", () => {
    const ui = loadUi();
    const hint = ui.diagnoseReasonHint!("some completely generic failure text", "mystery-model");
    assert.equal(hint, null, "hints must be narrow — no generic 'please try again' noise");
  });
});
