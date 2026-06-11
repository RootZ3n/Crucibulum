/**
 * Luak — C6 regression: provider baseUrl SSRF / credential-exfil guard.
 *
 * The /test probe sends the provider's Authorization header to
 * `${baseUrl}${probePath}`, so an attacker-chosen baseUrl is both an
 * unauthenticated SSRF gadget and a key-exfiltration channel. validateProviderBaseUrl
 * must reject non-http(s) schemes and loopback/private/link-local hosts for
 * non-local presets, while leaving local presets (Ollama) free to use localhost.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateProviderBaseUrl, isPrivateOrLocalHost } from "../core/provider-registry.js";
import { OpenRouterAdapter } from "../adapters/openrouter.js";
import { MiniMaxAdapter } from "../adapters/minimax.js";
import { PehAdapter } from "../adapters/peh.js";

describe("provider baseUrl SSRF guard (C6)", () => {
  it("rejects non-http(s) schemes for cloud providers", () => {
    for (const url of ["file:///etc/passwd", "ftp://example.com", "gopher://x", "data:text/plain,hi"]) {
      assert.ok(validateProviderBaseUrl(url, "cloud"), `should reject scheme: ${url}`);
    }
  });

  it("rejects loopback / private / link-local hosts for cloud providers", () => {
    const blocked = [
      "http://localhost:8080",
      "http://127.0.0.1/v1",
      "http://127.5.5.5/v1",
      "https://10.0.0.1/v1",
      "https://10.255.1.2/v1",
      "https://172.16.0.1/v1",
      "https://172.31.255.255/v1",
      "https://192.168.1.1/v1",
      "https://169.254.169.254/latest/meta-data", // cloud metadata SSRF classic
      "http://0.0.0.0/v1",
      "http://[::1]/v1",
      "http://[fd00::1]/v1",
      "http://[fe80::1]/v1",
    ];
    for (const url of blocked) {
      assert.ok(validateProviderBaseUrl(url, "cloud"), `should reject host: ${url}`);
    }
  });

  it("does NOT reject 172.15/172.32 (outside the private 16-31 range)", () => {
    assert.equal(validateProviderBaseUrl("https://172.15.0.1/v1", "cloud"), null);
    assert.equal(validateProviderBaseUrl("https://172.32.0.1/v1", "cloud"), null);
  });

  it("accepts ordinary public https URLs for cloud providers", () => {
    for (const url of ["https://api.openai.com/v1", "https://openrouter.ai/api/v1", "https://example.com:8443/v1"]) {
      assert.equal(validateProviderBaseUrl(url, "cloud"), null, `should accept: ${url}`);
    }
  });

  it("allows loopback/private hosts for LOCAL presets (Ollama)", () => {
    assert.equal(validateProviderBaseUrl("http://localhost:11434", "local"), null);
    assert.equal(validateProviderBaseUrl("http://127.0.0.1:11434", "local"), null);
    assert.equal(validateProviderBaseUrl("http://192.168.1.50:11434", "local"), null);
  });

  it("treats null/empty baseUrl as acceptable (use preset default)", () => {
    assert.equal(validateProviderBaseUrl(null, "cloud"), null);
    assert.equal(validateProviderBaseUrl("", "cloud"), null);
    assert.equal(validateProviderBaseUrl(undefined, "cloud"), null);
  });

  it("isPrivateOrLocalHost classifies representative hosts", () => {
    assert.equal(isPrivateOrLocalHost("8.8.8.8"), false);
    assert.equal(isPrivateOrLocalHost("api.openai.com"), false);
    assert.equal(isPrivateOrLocalHost("127.0.0.1"), true);
    assert.equal(isPrivateOrLocalHost("localhost"), true);
    assert.equal(isPrivateOrLocalHost("169.254.169.254"), true);
  });

  it("rejects unsafe adapter-level base_url overrides before fetch", async () => {
    await assert.rejects(
      () => new OpenRouterAdapter().init({ base_url: "http://127.0.0.1:9999/v1", model: "x", api_key: "secret" } as never),
      /Unsafe .*base_url/i,
    );
    await assert.rejects(
      () => new MiniMaxAdapter().init({ base_url: "http://169.254.169.254/v1", model: "x", api_key: "secret" } as never),
      /Unsafe MiniMax base_url/i,
    );
    await assert.rejects(
      () => new PehAdapter().init({ peh_url: "file:///etc/passwd" } as never),
      /Unsafe Peh base URL/i,
    );
  });
});
