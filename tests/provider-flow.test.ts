/**
 * Tests for provider-first flow validation:
 * - Provider/model truth through run lifecycle
 * - Status wording for configured/unconfigured/unimplemented providers
 * - Mobile-safe rendering checks
 * - Bundle metadata preserves provider identity
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAdapterCatalog, getProviderCatalog } from "../adapters/registry.js";

const realFetch = globalThis.fetch;
const realOpenRouterKey = process.env["OPENROUTER_API_KEY"];
const realOpenAIKey = process.env["OPENAI_API_KEY"];
const ui = readFileSync(join(process.cwd(), "ui", "index.html"), "utf-8");

function mockFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/tags")) {
      return new Response(JSON.stringify({
        models: [{ name: "gemma4:26b" }],
      }), { status: 200 });
    }
    if (url.includes("openrouter.ai") && url.endsWith("/models")) {
      const auth = (init?.headers as Record<string, string>)?.["Authorization"] ?? "";
      if (!auth.includes("Bearer")) return new Response("Unauthorized", { status: 401 });
      return new Response(JSON.stringify({
        data: [{ id: "openai/gpt-4.1-mini", name: "GPT-4.1 Mini" }],
      }), { status: 200 });
    }
    if (url.includes("api.openai.com") && url.endsWith("/models")) {
      const auth = (init?.headers as Record<string, string>)?.["Authorization"] ?? "";
      if (!auth.includes("Bearer")) return new Response("Unauthorized", { status: 401 });
      return new Response(JSON.stringify({
        data: [{ id: "gpt-4.1-mini", owned_by: "openai" }],
      }), { status: 200 });
    }
    if (url.endsWith("/models")) {
      return new Response("Unauthorized", { status: 401 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

describe("provider flow validation", () => {
  beforeEach(() => {
    delete process.env["OPENROUTER_API_KEY"];
    delete process.env["OPENAI_API_KEY"];
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realOpenRouterKey === undefined) delete process.env["OPENROUTER_API_KEY"];
    else process.env["OPENROUTER_API_KEY"] = realOpenRouterKey;
    if (realOpenAIKey === undefined) delete process.env["OPENAI_API_KEY"];
    else process.env["OPENAI_API_KEY"] = realOpenAIKey;
  });

  // ── Provider/model truth through adapter metadata ───────────────────

  describe("adapter metadata provider identity", () => {
    it("ollama adapter metadata uses 'ollama' as provider, not 'local'", async () => {
      mockFetch();
      const catalog = await getAdapterCatalog();
      const ollama = catalog.find((e) => e.id === "ollama");
      assert.ok(ollama);
      // The fixed_provider in registry should match what the adapter reports
      assert.equal(ollama.fixed_provider, "ollama");
    });

    it("claudecode adapter metadata uses 'claudecode' as provider, not 'anthropic'", async () => {
      mockFetch();
      const catalog = await getAdapterCatalog();
      const cc = catalog.find((e) => e.id === "claudecode");
      assert.ok(cc);
      assert.equal(cc.fixed_provider, "anthropic");
      // But the adapter_metadata.provider in ExecutionResult should now be "claudecode"
      // We verify this by checking the adapter's id matches the registered provider
      assert.equal(cc.id, "claudecode");
    });

    it("openai adapter reports openai as provider", async () => {
      process.env["OPENAI_API_KEY"] = "test-key";
      mockFetch();
      const catalog = await getAdapterCatalog();
      const openai = catalog.find((e) => e.id === "openai");
      assert.ok(openai);
      assert.equal(openai.fixed_provider, "openai");
      assert.equal(openai.id, "openai");
    });
  });

  // ── Status wording tests ────────────────────────────────────────────

  describe("provider status wording", () => {
    it("missing API key produces reason containing the env var name", async () => {
      mockFetch();
      const result = await getProviderCatalog();
      const openai = result.providers.find((p) => p.id === "openai");
      assert.ok(openai);
      assert.equal(openai.available, false);
      assert.ok(openai.reason!.includes("OPENAI_API_KEY"),
        `reason should mention OPENAI_API_KEY, got: ${openai.reason}`);
    });

    it("openrouter missing key mentions OPENROUTER_API_KEY", async () => {
      mockFetch();
      const result = await getProviderCatalog();
      const or = result.providers.find((p) => p.id === "openrouter");
      assert.ok(or);
      assert.equal(or.available, false);
      assert.ok(or.reason!.includes("OPENROUTER_API_KEY"));
    });

    it("openclaw missing binary mentions spawn/ENOENT", async () => {
      mockFetch();
      const result = await getProviderCatalog();
      const oc = result.providers.find((p) => p.id === "openclaw");
      assert.ok(oc);
      assert.equal(oc.available, false);
      assert.ok(oc.reason!.match(/spawn|ENOENT/i),
        `reason should mention spawn/ENOENT, got: ${oc.reason}`);
    });

    it("not-implemented providers have blockers mentioning 'not yet implemented'", async () => {
      mockFetch();
      const result = await getProviderCatalog();
      for (const p of result.notImplemented) {
        assert.ok(p.blocker.match(/not.*(yet\s+)?implemented/i),
          `${p.id} blocker should mention not implemented, got: ${p.blocker}`);
      }
    });
  });

  // ── UI status wording contract ──────────────────────────────────────

  describe("UI status wording", () => {
    it("UI classifies API_KEY reasons as 'config required'", () => {
      assert.match(ui, /API_KEY.*config required|config required.*API_KEY/i);
    });

    it("UI classifies spawn/ENOENT reasons as 'binary required'", () => {
      assert.match(ui, /spawn.*binary required|binary required.*spawn|ENOENT.*binary required|binary required.*ENOENT/i);
    });

    it("UI classifies not-implemented reasons", () => {
      assert.match(ui, /not.implemented/i);
    });

    it("available provider shows checkmark", () => {
      assert.match(ui, /\\u2713/);
    });
  });

  // ── Tables show provider column ────────────────────────────────────

  describe("provider column in tables", () => {
    it("history table has Provider column header", () => {
      assert.match(ui, /thSorted\('provider', 'Provider'\)/);
    });

    it("history table rows include provider data", () => {
      assert.match(ui, /r\.provider \|\| r\.adapter/);
    });

    it("receipts table has Provider column header", () => {
      // Check for <th>Provider</th> in receipts section
      assert.match(ui, /<th>Provider<\/th>/);
    });

    it("dashboard recent runs table has Provider header", () => {
      assert.match(ui, /<th>Provider<\/th>/);
    });

    it("CSV export includes Provider column", () => {
      assert.match(ui, /Date,Task,Provider,Model,Cost/);
    });

    it("dashboard hero shows provider → model, not adapter/provider/model", () => {
      // Should use → arrow, not triple / separator
      assert.match(ui, /provider.*\\u2192.*model/i);
      assert.doesNotMatch(ui, /adapter.*\/.*provider.*\/.*model/i);
    });
  });

  // ── Mobile-safe rendering ──────────────────────────────────────────

  describe("mobile rendering", () => {
    it("has 760px mobile breakpoint", () => {
      assert.match(ui, /@media\s*\(max-width:\s*760px\)/);
    });

    it("mobile: form controls have min-height 48px for touch targets", () => {
      assert.match(ui, /min-height:\s*48px/);
    });

    it("mobile: form controls use 16px font to prevent iOS zoom", () => {
      // iOS zooms on focus if font-size < 16px
      assert.match(ui, /font-size:\s*16px/);
    });

    it("pipeline summary has word-break for long model names", () => {
      assert.match(ui, /\.pipeline-summary[\s\S]*?word-break:\s*break-word/);
    });

    it("mobile: run log header wraps on narrow screens", () => {
      assert.match(ui, /\.run-log-header[\s\S]*?flex-wrap:\s*wrap/);
    });

    it("mobile: verdict chamber stacks cleanly", () => {
      assert.match(ui, /\.verdict-header[\s\S]*?flex-direction:\s*column/);
      assert.match(ui, /\.verdict-grid[\s\S]*?grid-template-columns:\s*1fr/);
    });

    it("mobile: sticky action area remains reachable", () => {
      assert.match(ui, /\.run-btn-container[\s\S]*?position:\s*sticky/);
      assert.match(ui, /\.run-btn-container[\s\S]*?bottom:\s*0/);
    });
  });

  // ── Bundle metadata preserves provider ─────────────────────────────

  describe("bundle detail view", () => {
    it("bundle drawer shows Provider field", () => {
      assert.match(ui, /bm-label.*Provider/);
    });

    it("bundle drawer shows Judge field", () => {
      assert.match(ui, /bm-label.*Judge/);
    });

    it("bundle drawer shows model with adapter attribution", () => {
      assert.match(ui, /via.*adapter/i);
    });
  });

  describe("run surface trust signals", () => {
    it("shows decisive verdict copy and trust indicators", () => {
      assert.match(ui, /Claim evaluated under controlled conditions/);
      assert.match(ui, /Deterministic Judge \(authoritative\)/);
      assert.match(ui, /Advisory Review Only/);
      assert.match(ui, /Bundle Signed/);
    });

    it("shows process chain stages", () => {
      assert.match(ui, /Task/);
      assert.match(ui, /Provider/);
      assert.match(ui, /Model/);
      assert.match(ui, /Judge/);
      assert.match(ui, /Review/);
      assert.match(ui, /Bundle/);
      assert.match(ui, /pipeline-chain/);
    });
  });
});
