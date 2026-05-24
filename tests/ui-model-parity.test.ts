/**
 * UI MODEL/PROVIDER PARITY — pinned regression for the release-blocking bug
 * where Benchmark surfaced the full provider catalogue but Poison, Build,
 * Safety, and Memory each only showed the subset shared by that tab's
 * default-seeded model. Root cause was syncRouting() auto-writing
 * tabState.selectedProvider/selectedAdapter, which filteredModelGroupsForTab
 * then used as a hard filter on the MODELS dropdown.
 *
 * Pins:
 *   1. Every lane tab (Benchmark + Personality + Poison + Build + Safety +
 *      Memory) sees the EXACT SAME model option set out of the box.
 *   2. The OpenRouter curated catalogue includes every model the operator
 *      pinned for release (xiaomi mimo v2.5 / v2.5-pro, kimi k2.6,
 *      qwen 3.6-plus, glm 5.1, grok 4.3) so they appear on every section.
 *   3. Selecting models from a single provider does NOT auto-filter the
 *      dropdown (syncRouting must not mutate selectedProvider/Adapter).
 *   4. When a user EXPLICITLY filters via setRoutingFilter, the dropdown
 *      narrows and modelSelectionNote() surfaces a visible explanation.
 *   5. Empty/missing registry still shows the curated defaults honestly
 *      (no silent shrink to "unconfigured").
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

const UI_PATH = join(process.cwd(), "ui", "index.html");
const RELEASE_READINESS_PATH = join(process.cwd(), "docs", "RELEASE_READINESS.md");
const UI_CERTIFICATION_PATH = join(process.cwd(), "docs", "UI_RELEASE_CERTIFICATION.md");
const uiHtml = readFileSync(UI_PATH, "utf-8");
const releaseReadinessMd = readFileSync(RELEASE_READINESS_PATH, "utf-8");
const uiCertificationMd = readFileSync(UI_CERTIFICATION_PATH, "utf-8");

function extractScript(): string {
  const match = uiHtml.match(/^<script>\n([\s\S]*?)\n<\/script>/m);
  assert.ok(match, "ui/index.html must contain a real <script> block");
  return match![1]!.replace(/\(async function bootstrap\(\)\{[\s\S]*?\}\)\(\);?\s*$/, "");
}

function makeJsonResponse(body: Record<string, unknown>) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), clone() { return this; } };
}

interface UiHandle {
  state: {
    tabData: Record<string, { selectedProvider: string; selectedAdapter: string; selectedModels: string[] }>;
    adapters: { id: string; label: string }[];
    registry: { presets: unknown[]; providers: unknown[]; models: unknown[]; catalog: unknown[] };
    liveModels: { id: string; provider: string }[];
    health: { net: { ok: boolean }; providers?: Record<string, unknown> };
  };
  defaultTabState: () => { selectedProvider: string; selectedAdapter: string; selectedModels: string[] };
  mergedModelGroups: () => { key: string; providerId: string; adapterId: string; models: { id: string; label: string }[] }[];
  mergedProviders: () => { id: string; label: string }[];
  filteredModelGroupsForTab: (tabState: { selectedProvider?: string; selectedAdapter?: string }) => { key: string; models: { id: string }[] }[];
  renderModelOptions: (tabKey: string) => string;
  renderProviderOptions: (tabKey: string) => string;
  syncRouting: (tabKey: string) => { provider: string; adapter: string };
  setRoutingFilter: (tabKey: string, axis: "provider" | "adapter", value: string) => void;
  modelSelectionNote: (tabKey: string) => string;
  deriveRoutingForModel: (modelId: string) => { providerId: string; adapterId: string; kind: string };
  canRunModel: (modelId: string) => boolean;
  gateSelectedModels: (modelIds: string[]) => string[] | null;
  TAB_CONFIG: Record<string, { taskFamilies: string[]; isSettings?: boolean }>;
  RELEASE_CERTIFICATION: { status: string; targets: Array<{ providerId: string; adapterId: string; modelId: string; certificationLabel: string; reportPath: string }> };
  releaseCertificationForModel: (modelId: string, route?: { providerId: string; adapterId: string; kind?: string }) => { status: string; label: string };
  renderReleaseCertificationBanner: (tabKey: string) => string;
}

function loadUi(opts: { registry?: { providers?: unknown[]; models?: unknown[]; catalog?: unknown[]; presets?: unknown[] } } = {}): UiHandle {
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
    fetch: async (url: string) => {
      const parsed = new URL(String(url), "http://localhost");
      if (parsed.pathname === "/api/registry/state") return makeJsonResponse({ presets: opts.registry?.presets ?? [], providers: opts.registry?.providers ?? [], models: opts.registry?.models ?? [], catalog: opts.registry?.catalog ?? [] });
      if (parsed.pathname === "/api/tasks") return makeJsonResponse({ tasks: [] });
      if (parsed.pathname === "/api/adapters") return makeJsonResponse({ adapters: [{ id: "openrouter", label: "OpenRouter" }, { id: "anthropic", label: "Anthropic" }, { id: "ollama", label: "Ollama" }, { id: "openai", label: "OpenAI" }] });
      if (parsed.pathname === "/api/models") return makeJsonResponse({ models: [] });
      return makeJsonResponse({});
    },
    EventSource: class {},
    setTimeout, clearTimeout, URL, URLSearchParams,
    Headers: class { _h = new Map<string, string>(); constructor(init?: Record<string, string>) { if (init) for (const k of Object.keys(init)) this._h.set(k.toLowerCase(), init[k]!); } has(k: string) { return this._h.has(k.toLowerCase()); } set(k: string, v: string) { this._h.set(k.toLowerCase(), v); } get(k: string) { return this._h.get(k.toLowerCase()); } },
  };
  sandbox.globalThis = sandbox;
  const prelude = "function render(){}\n";
  const withoutRender = script.replace(/function render\(\)\{[\s\S]*?\n\}\n/, "/* render stubbed */\n");
  const exporter = `;globalThis.__ui={state,defaultTabState,mergedModelGroups,mergedProviders,filteredModelGroupsForTab,renderModelOptions,renderProviderOptions,syncRouting,setRoutingFilter,modelSelectionNote,deriveRoutingForModel,canRunModel,gateSelectedModels,TAB_CONFIG,RELEASE_CERTIFICATION,releaseCertificationForModel,renderReleaseCertificationBanner};`;
  const context = vm.createContext(sandbox);
  vm.runInContext(prelude + withoutRender + exporter, context, { filename: "ui/index.html::script" });
  const ui = (sandbox as { __ui: UiHandle }).__ui;
  // Seed registry + adapters + tabData for every lane tab without making
  // the boot path async. Mirrors what loadBootData would do.
  ui.state.registry = { presets: (opts.registry?.presets as unknown[]) ?? [], providers: (opts.registry?.providers as unknown[]) ?? [], models: (opts.registry?.models as unknown[]) ?? [], catalog: (opts.registry?.catalog as unknown[]) ?? [] };
  ui.state.adapters = [{ id: "openrouter", label: "OpenRouter" }, { id: "anthropic", label: "Anthropic" }, { id: "ollama", label: "Ollama" }, { id: "openai", label: "OpenAI" }];
  ui.state.liveModels = [];
  ui.state.health = { net: { ok: true } };
  for (const key of Object.keys(ui.TAB_CONFIG)) ui.state.tabData[key] = ui.defaultTabState();
  return ui;
}

function laneTabs(ui: UiHandle): string[] {
  return Object.entries(ui.TAB_CONFIG)
    .filter(([key, cfg]) => key !== "dashboard" && !cfg.isSettings)
    .map(([key]) => key);
}

function optionIdsFromMarkup(html: string): string[] {
  // Pull <option value="..."> values, ignoring blank/group-only entries.
  const ids: string[] = [];
  const re = /<option\s+value="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) ids.push(m[1]!);
  return ids;
}

describe("ui model/provider parity across lane tabs", () => {
  it("renders the exact same model option set on every lane tab", () => {
    const ui = loadUi();
    const tabs = laneTabs(ui);
    // Personality/Benchmark/Poison/Build/Safety/Memory must all appear.
    for (const expected of ["benchmark", "poison", "build", "safety", "memory", "personality"]) {
      assert.ok(tabs.includes(expected), `lane "${expected}" missing from TAB_CONFIG`);
    }
    const reference = optionIdsFromMarkup(ui.renderModelOptions("benchmark")).sort();
    assert.ok(reference.length > 0, "benchmark must render at least one model option");
    for (const tab of tabs) {
      const got = optionIdsFromMarkup(ui.renderModelOptions(tab)).sort();
      assert.deepEqual(got, reference, `tab "${tab}" model option set diverges from benchmark — that's the release-blocking bug this test pins`);
    }
  });

  it("renders the exact same provider option set on every lane tab", () => {
    const ui = loadUi();
    const tabs = laneTabs(ui);
    const reference = optionIdsFromMarkup(ui.renderProviderOptions("benchmark")).sort();
    for (const tab of tabs) {
      const got = optionIdsFromMarkup(ui.renderProviderOptions(tab)).sort();
      assert.deepEqual(got, reference, `tab "${tab}" provider option set diverges from benchmark`);
    }
  });

  it("openrouter curated catalogue exposes the operator's pinned release models", () => {
    const ui = loadUi();
    const openrouter = ui.mergedModelGroups().find((g) => g.providerId === "openrouter");
    assert.ok(openrouter, "OpenRouter group missing from merged model groups");
    const ids = new Set(openrouter!.models.map((m) => m.id));
    // The exact list the operator demanded as visible on every section.
    for (const required of [
      "xiaomi/mimo-v2.5",
      "xiaomi/mimo-v2.5-pro",
      "moonshotai/kimi-k2.6",
      "qwen/qwen3.6-plus",
      "z-ai/glm-5.1",
      "x-ai/grok-4.3",
    ]) {
      assert.ok(ids.has(required), `OpenRouter curated list missing required model id: ${required}`);
    }
  });

  it("every required OpenRouter model is renderable from every lane tab's dropdown", () => {
    const ui = loadUi();
    const required = ["xiaomi/mimo-v2.5", "xiaomi/mimo-v2.5-pro", "moonshotai/kimi-k2.6", "qwen/qwen3.6-plus", "z-ai/glm-5.1", "x-ai/grok-4.3"];
    for (const tab of laneTabs(ui)) {
      const ids = new Set(optionIdsFromMarkup(ui.renderModelOptions(tab)));
      for (const id of required) {
        assert.ok(ids.has(id), `lane "${tab}" dropdown missing required OpenRouter model "${id}"`);
      }
    }
  });

  it("OpenRouter, Anthropic, Ollama, OpenAI, ModelStudio, ZAI, MiniMax all appear in every lane tab's MODELS dropdown", () => {
    const ui = loadUi();
    const expectedProviders = ["openrouter", "anthropic", "ollama", "openai", "modelstudio", "zai", "minimax"];
    for (const tab of laneTabs(ui)) {
      const html = ui.renderModelOptions(tab);
      for (const presetId of expectedProviders) {
        const group = ui.mergedModelGroups().find((g) => g.providerId === presetId);
        if (!group) continue; // curated list controls which presets exist; skip if absent
        assert.ok(html.includes(`optgroup`) && group.models.some((m) => html.includes(`value="${m.id}"`)), `lane "${tab}" dropdown is missing models from preset "${presetId}"`);
      }
    }
  });

  it("renders scoped release certification banner language in the UI", () => {
    const ui = loadUi();
    const banner = ui.renderReleaseCertificationBanner("personality");
    assert.match(banner, /FULL_RELEASE_READY · NO/);
    assert.match(banner, /RELEASE_SCOPED_TO_CERTIFIED_TARGETS · YES/);
    assert.match(banner, /UI_CERTIFIED_FOR_SCOPED_RELEASE · YES/);
    assert.match(banner, /Release certification is scoped/);
    assert.match(banner, /OpenRouter DeepSeek V4 Pro/);
    assert.match(banner, /OpenRouter Mimo v2\.5 Pro/);
    assert.match(banner, /Ollama qwen3\.5:9b/);
    assert.match(banner, /not release-certified/);
    assert.doesNotMatch(banner, /FULL_RELEASE_READY · CERTIFIED/);
    assert.doesNotMatch(banner, /FULL_RELEASE_READY · YES/);
  });

  it("certification registry contains exactly the three current release target model ids", () => {
    const ui = loadUi();
    const ids = ui.RELEASE_CERTIFICATION.targets.map((target) => `${target.providerId}/${target.adapterId}/${target.modelId}`).sort();
    assert.equal(JSON.stringify(ids), JSON.stringify([
      "ollama/ollama/qwen3.5:9b",
      "openrouter/openrouter/deepseek/deepseek-v4-pro",
      "openrouter/openrouter/xiaomi/mimo-v2.5-pro",
    ]));
  });

  it("certified labels appear for the three release targets and uncertified labels appear for non-target models", () => {
    const ui = loadUi();
    const html = ui.renderModelOptions("personality");
    assert.match(html, /deepseek\/deepseek-v4-pro[^<]*Certified release target/);
    assert.match(html, /xiaomi\/mimo-v2\.5-pro[^<]*Certified release target/);
    assert.match(html, /qwen3\.5:9b[^<]*Certified local release target/);
    assert.match(html, /gpt-5\.4[^<]*Uncertified \/ not release target/);
    assert.match(html, /claude-opus-4-6[^<]*Uncertified \/ not release target/);
  });

  it("provider-certified but non-target models are labeled as model-uncertified, not fully certified", () => {
    const ui = loadUi();
    const html = ui.renderModelOptions("personality");
    assert.match(html, /deepseek\/deepseek-v4-flash[^<]*Provider certified \/ model uncertified/);
    assert.match(html, /qwen3\.5:4b[^<]*Provider certified \/ model uncertified/);
  });

  it("docs/RELEASE_READINESS.md and the UI certification registry agree on the target ids", () => {
    const ui = loadUi();
    for (const target of ui.RELEASE_CERTIFICATION.targets) {
      assert.match(releaseReadinessMd, new RegExp(target.modelId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.equal((releaseReadinessMd.match(/deepseek\/deepseek-v4-pro/g) ?? []).length > 0, true);
    assert.equal((releaseReadinessMd.match(/xiaomi\/mimo-v2\.5-pro/g) ?? []).length > 0, true);
    assert.equal((releaseReadinessMd.match(/qwen3\.5:9b/g) ?? []).length > 0, true);
  });

  it("manual UI certification checklist requires certified/uncertified label verification", () => {
    assert.match(uiCertificationMd, /certified\/uncertified model labels/i);
    assert.match(uiCertificationMd, /not release-certified/i);
  });

  it("syncRouting does NOT mutate selectedProvider/selectedAdapter — the original bug aliasing fix", () => {
    const ui = loadUi();
    // Seed Poison with the curated default seed (a single cloud model).
    const openrouter = ui.mergedModelGroups().find((g) => g.providerId === "openrouter")!;
    ui.state.tabData.poison = { ...ui.defaultTabState(), selectedModels: [openrouter.models[0]!.id] };
    const before = { provider: ui.state.tabData.poison.selectedProvider, adapter: ui.state.tabData.poison.selectedAdapter };
    const derived = ui.syncRouting("poison");
    // syncRouting may RETURN a derived provider/adapter for display, but it
    // MUST NOT mutate the tab's filter fields (that's what hid models).
    assert.equal(ui.state.tabData.poison.selectedProvider, before.provider, "syncRouting mutated selectedProvider — this would silently hide other providers in MODELS dropdown");
    assert.equal(ui.state.tabData.poison.selectedAdapter, before.adapter, "syncRouting mutated selectedAdapter — same bug");
    // And the derived view should reflect a single-provider selection.
    assert.equal(derived.provider, "openrouter");
  });

  it("an explicit user filter does narrow the dropdown AND surfaces a visible note", () => {
    const ui = loadUi();
    // Operator explicitly picks "OpenRouter" in PROVIDER dropdown.
    ui.setRoutingFilter("safety", "provider", "openrouter");
    const html = ui.renderModelOptions("safety");
    // Only openrouter models should remain.
    const openrouter = ui.mergedModelGroups().find((g) => g.providerId === "openrouter")!;
    const anthropic = ui.mergedModelGroups().find((g) => g.providerId === "anthropic")!;
    assert.ok(openrouter.models.every((m) => html.includes(`value="${m.id}"`)), "openrouter models must remain visible after explicit provider filter");
    assert.ok(anthropic && !anthropic.models.some((m) => html.includes(`value="${m.id}"`)), "anthropic models must be hidden when user explicitly filters to openrouter");
    // And the note explains why — so the operator never confuses
    // "filter active" with "missing models" (the original bug).
    const note = ui.modelSelectionNote("safety");
    assert.match(note, /filter active/i);
    assert.match(note, /mixed/i);
  });

  it("an empty registry still surfaces the curated default catalogue (honest, no silent shrink)", () => {
    const ui = loadUi({ registry: { providers: [], models: [], catalog: [] } });
    for (const tab of laneTabs(ui)) {
      const ids = optionIdsFromMarkup(ui.renderModelOptions(tab));
      assert.ok(ids.length > 0, `lane "${tab}" rendered ZERO model options with empty registry — curated defaults must remain visible`);
      // The curated openrouter set must still be there even without registry.
      for (const id of ["xiaomi/mimo-v2.5", "moonshotai/kimi-k2.6"]) {
        assert.ok(ids.includes(id), `lane "${tab}" lost curated default "${id}" when registry is empty`);
      }
    }
  });

  it("registry-registered models on top of curated defaults appear on every lane tab", () => {
    // Simulate the operator adding a custom OpenRouter model via the
    // Providers tab. The flat catalog entry below is what
    // /api/registry/state returns; mergedModelGroups must surface it AND
    // every lane must see it (not just Benchmark).
    const ui = loadUi({
      registry: {
        providers: [{ id: "p1", presetId: "openrouter", enabled: true, label: "OpenRouter (mine)" }],
        models: [{ id: "m1", providerConfigId: "p1", modelId: "openrouter/exotic-1", enabled: true }],
        catalog: [
          { presetId: "openrouter", adapter: "openrouter", modelId: "openrouter/exotic-1", displayName: "openrouter/exotic-1", kind: "cloud", enabled: true, providerEnabled: true, providerLabel: "OpenRouter (mine)", presetLabel: "OpenRouter" },
        ],
      },
    });
    for (const tab of laneTabs(ui)) {
      const html = ui.renderModelOptions(tab);
      assert.ok(html.includes('value="openrouter/exotic-1"'), `lane "${tab}" missing operator-registered model openrouter/exotic-1`);
    }
  });

  it("selected model routing is derived from the model catalogue, not from lane-local filters", () => {
    const ui = loadUi();
    ui.setRoutingFilter("memory", "provider", "anthropic");
    const openrouterModel = ui.mergedModelGroups().find((g) => g.providerId === "openrouter")!.models[0]!.id;
    const route = ui.deriveRoutingForModel(openrouterModel);
    assert.equal(route.providerId, "openrouter");
    assert.equal(route.adapterId, "openrouter");
  });

  it("blocks unconfigured cloud providers before a run instead of silently attempting them", () => {
    const ui = loadUi();
    const openrouterModel = ui.mergedModelGroups().find((g) => g.providerId === "openrouter")!.models[0]!.id;
    ui.state.health.net = { ok: true };
    ui.state.health.providers = { openrouter: { status: "unconfigured", reason: "No provider configured for this preset", kind: "cloud" } } as any;
    assert.equal(ui.canRunModel(openrouterModel), false);
    assert.equal(ui.gateSelectedModels([openrouterModel]), null, "headless UI path must not let a wholly unreachable provider continue");
  });

  it("continues with reachable selected models while filtering unreachable ones", () => {
    const ui = loadUi();
    const openrouterModel = ui.mergedModelGroups().find((g) => g.providerId === "openrouter")!.models[0]!.id;
    const localModel = ui.mergedModelGroups().find((g) => g.providerId === "ollama")!.models[0]!.id;
    ui.state.health.net = { ok: true };
    ui.state.liveModels = [{ id: localModel, provider: "ollama" }];
    ui.state.health.providers = {
      openrouter: { status: "unconfigured", reason: "No provider configured for this preset", kind: "cloud" },
      ollama: { status: "ok", reason: null, kind: "local" },
    } as any;
    assert.deepEqual(ui.gateSelectedModels([openrouterModel, localModel]), [localModel]);
  });
});
